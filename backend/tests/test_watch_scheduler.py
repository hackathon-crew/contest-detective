import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select

from contest_detective.server.account.models import Follow
from contest_detective.server.contest import service as contests
from contest_detective.server.contest.models import ContestEvent, ContestPage
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.notifications.watch.config import WatchSettings
from contest_detective.server.notifications.watch.models import Check, Subscription
from contest_detective.server.notifications.watch.scheduler import due_contests, run_due, start_watch_scheduler
from contest_detective.server.notifications.watch.service import statuses
from contest_detective.server.research_pipeline.verification import verify_recent
from contest_detective.server.user.models import User

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
USER = UUID('22222222-2222-2222-2222-222222222222')


def setup(session, number, url=None):
    if session.get(User, USER) is None:
        session.add(User(id=USER, email='watch@example.com', hashed_password='not-used', is_active=True))
        session.flush()
    claims = [{'field': 'city', 'value': '上海', 'excerpt': '上海'}]
    if url:
        claims.append({'field': 'registration_url', 'value': url, 'excerpt': url})
    cid = contests.save(session, ContestDraft(name=f'赛事{number}', page={
        'url': f'https://reposted.example/{number}', 'site': '转载', 'title': '赛事', 'is_official': False}, claims=claims))
    session.add(Follow(user_id=USER, contest_id=cid))
    session.add(Subscription(user_id=USER, contest_id=cid, enabled=True,
        activated_event_id=session.scalar(select(ContestEvent.id).order_by(ContestEvent.id.desc()).limit(1))))
    session.commit()
    return cid


def test_disabled_scheduler_does_not_construct_provider_or_query(session_factory, monkeypatch):
    from contest_detective.server.notifications.watch import scheduler
    def denied(*args, **kwargs):
        raise AssertionError('disabled scheduler must not call dependencies')
    monkeypatch.setattr(scheduler, 'get_watch_settings', lambda: WatchSettings(watch_enabled=False))
    assert start_watch_scheduler(denied, extractor_factory=denied) is None
    assert asyncio.run(run_due(denied, extractor=None, config=WatchSettings(watch_enabled=False))) == []


def test_due_selection_fairly_reaches_more_than_thirty_and_skips_paused(session_factory):
    with session_factory() as session:
        ids = [setup(session, number) for number in range(35)]
        paused = setup(session, 36)
        session.get(Subscription, (USER, paused)).enabled = False
        session.commit()
    config = WatchSettings(watch_enabled=True)
    first = asyncio.run(run_due(session_factory, extractor=None, config=config, now=NOW, clock=lambda: NOW))
    second = asyncio.run(run_due(session_factory, extractor=None, config=config, now=NOW, clock=lambda: NOW))
    assert len(first) == 30 and len(second) == 5
    assert {row.contest_id for row in first+second} == set(ids)
    assert all(row.outcome == 'no_source' for row in first+second)
    assert asyncio.run(run_due(session_factory, extractor=None, config=config, now=NOW, clock=lambda: NOW)) == []
    with session_factory() as session:
        assert len(due_contests(session, NOW+timedelta(days=1), interval_minutes=1440, limit=100)) == 35
        assert all(row.next_check_at is None for row in statuses(session, USER, now=NOW, config=config))


def test_targeted_checks_fetch_shared_url_once_and_record_each_contest(session_factory):
    url = 'https://organizer.example/shared'
    with session_factory() as session:
        a, b = setup(session, 1, url), setup(session, 2, url)
    visited, persisted = [], []
    async def fetch(value):
        visited.append(value)
        return '城市：北京'
    async def runner(value, **kwargs):
        cid = kwargs['contest_id']
        persisted.append(cid)
        with session_factory() as session:
            contests.save(session, ContestDraft(name='实际赛事', page={'url': value, 'site': '主办方',
                'title': '规则', 'is_official': True}, claims=[{'field': 'city', 'value': '北京', 'excerpt': '城市：北京'}]), contest_id=cid)
        return cid
    config = WatchSettings(watch_enabled=True)
    checked = asyncio.run(run_due(session_factory, extractor=None, config=config, now=NOW,
        fetcher=fetch, runner=runner, clock=lambda: NOW))
    assert visited == [url]
    assert set(persisted) == {a, b}
    assert {row.contest_id for row in checked} == {a, b}
    assert all(row.outcome == 'changed' and row.source_url == url for row in checked)
    with session_factory() as session:
        assert all(session.get(Check, cid).last_success_at is not None for cid in (a,b))
    # Even hash-unchanged results need a real fetch. They do not execute extraction.
    visited.clear(); persisted.clear()
    checked = asyncio.run(run_due(session_factory, extractor=None, config=config, now=NOW+timedelta(days=1),
        fetcher=fetch, runner=runner, clock=lambda: NOW+timedelta(days=1)))
    assert visited == [url] and persisted == []
    assert all(row.outcome == 'unchanged' for row in checked)


def test_failed_fetch_does_not_advance_success_or_cache_and_remains_retryable(session_factory):
    url = 'https://organizer.example/fail'
    with session_factory() as session:
        cid = setup(session, 1, url)
        session.add(Check(contest_id=cid, checked_at=NOW, completed_at=NOW, outcome='unchanged', source_url=url, last_success_at=NOW))
        session.commit()
    async def fetch(_):
        raise TimeoutError('failure has no private credentials')
    later = NOW+timedelta(days=1)
    checked = asyncio.run(run_due(session_factory, extractor=None, config=WatchSettings(watch_enabled=True),
        now=later, fetcher=fetch, clock=lambda: later))
    assert checked[0].outcome == 'failed' and checked[0].error_type == 'TimeoutError'
    with session_factory() as session:
        row = session.get(Check, cid)
        assert row.last_success_at.replace(tzinfo=timezone.utc) == NOW
        assert session.scalar(select(ContestPage).where(ContestPage.url == url)) is None
        assert due_contests(session, later+timedelta(days=1), interval_minutes=1440, limit=30) == [cid]
        value = statuses(session, USER, now=later, config=WatchSettings(watch_enabled=False))[0]
        assert value.state == 'scheduler_paused' and value.next_check_at is None
        assert value.last_check.outcome == 'failed' and value.last_success_at == NOW


def test_explicit_target_list_never_checks_unrequested_contests(session_factory):
    with session_factory() as session:
        a, b = setup(session, 1, 'https://organizer.example/a'), setup(session, 2, 'https://organizer.example/b')
    calls = []
    async def fetch(url):
        calls.append(url)
        raise TimeoutError()
    report = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=[a], fetcher=fetch, now=NOW, clock=lambda: NOW))
    assert calls == ['https://organizer.example/a']
    assert [row.contest_id for row in report.checks] == [a]


def test_deferred_targets_are_not_falsely_marked_no_source(session_factory):
    with session_factory() as session:
        ids = [setup(session, i, f'https://organizer.example/{i}') for i in range(2)]
    async def fetch(_):
        raise TimeoutError()
    report = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=ids, limit=1, fetcher=fetch, now=NOW, clock=lambda: NOW))
    assert len(report.checks) == 1 and report.checks[0].outcome == 'failed'


def test_shared_cache_never_masks_failed_or_new_contest_application(session_factory):
    url = 'https://organizer.example/shared-retry'
    with session_factory() as session:
        a, b = setup(session, 10, url), setup(session, 11, url)
    calls = []
    failed = {b}
    async def fetch(_):
        return '地点北京'
    async def runner(value, **kwargs):
        cid = kwargs['contest_id']; calls.append(cid)
        if cid in failed:
            raise ValueError('抽取失败')
        with session_factory() as session:
            return contests.save(session, ContestDraft(name='赛事', page={
                'url': value, 'site': '主办方', 'title': '赛事', 'is_official': True},
                claims=[{'field':'city','value':'北京','excerpt':'地点北京'}]), contest_id=cid)
    first = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=[a,b], fetcher=fetch, runner=runner, now=NOW, clock=lambda: NOW))
    assert {row.contest_id:row.outcome for row in first.checks} == {a:'changed', b:'failed'}
    failed.clear(); calls.clear()
    second = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=[b], fetcher=fetch, runner=runner, now=NOW, clock=lambda: NOW))
    assert calls == [b] and second.checks[0].outcome == 'changed'
    with session_factory() as session:
        assert contests.get(session, b).fields['city'].value == '北京'
        c = setup(session, 12, url)
    calls.clear()
    asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=[c], fetcher=fetch, runner=runner, now=NOW, clock=lambda: NOW))
    assert calls == [c]


def test_explicit_watch_of_ended_contest_is_not_mislabeled_no_source(session_factory):
    url = 'https://organizer.example/ended'
    with session_factory() as session:
        cid = setup(session, 1, url)
        contests.save(session, ContestDraft(name='赛事1', page={'url':'https://reposted.example/1',
            'site':'转载','title':'赛事1','is_official':False}, claims=[
                {'field':'registration_url','value':url,'excerpt':url},
                {'field':'end_at','value':'2026-10-01','precision':'day','excerpt':'10月1日结束'}]), contest_id=cid)
    calls=[]
    async def fetch(value):
        calls.append(value)
        raise TimeoutError()
    result=asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        contest_ids=[cid],fetcher=fetch,now=NOW,clock=lambda:NOW))
    assert calls == [url] and result.checks[0].outcome == 'failed'


def test_concurrent_ingestion_cannot_stamp_a_stale_applied_hash(session_factory):
    url='https://organizer.example/race'
    with session_factory() as session:
        cid=setup(session,1,url)
    async def fetch(_): return '北京'
    async def runner(value, **kwargs):
        for city in ('北京','深圳'):
            with session_factory() as session:
                contests.save(session, ContestDraft(name='赛事', page={'url':value,'site':'主办方',
                    'title':'赛事','is_official':True},claims=[{'field':'city','value':city,'excerpt':city}]), contest_id=cid)
        return cid
    result=asyncio.run(verify_recent(session_factory=session_factory,extractor=None,
        contest_ids=[cid],fetcher=fetch,runner=runner,now=NOW,clock=lambda:NOW))
    assert result.checks[0].outcome == 'failed'
    from contest_detective.server.contest.models import ContestPageLink
    with session_factory() as session:
        page=session.scalar(select(ContestPage).where(ContestPage.url==url))
        assert session.get(ContestPageLink,(cid,page.id)).verified_content_hash is None
