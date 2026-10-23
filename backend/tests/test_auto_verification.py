import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from contest_detective.server.contest import service
from contest_detective.server.contest.models import ContestPage
from contest_detective.server.contest.schemas import ContestDraft, ContestQuery

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)


def seed(session, number, *, deadline=None, start=None, url=None, date_claims=()):
    claims = {'registration_url': url or f'https://organizer.example/{number}'}
    if deadline is not None:
        claims['registration_deadline'] = deadline.isoformat()
    if start is not None:
        claims['start_at'] = start.isoformat()
    return service.save(session, ContestDraft(name=f'活动 {number}',
        page={'url': f'https://hackertrip.space/hackathon/{number}', 'site': 'HackerTrip',
              'title': f'活动 {number}', 'is_official': False},
        claims=[{'field': field, 'value': value, 'excerpt': value} for field, value in claims.items()] + list(date_claims)))


@pytest.mark.parametrize('field', ['start_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified'])
def test_today_day_nodes_remain_verification_targets_after_their_anchor(session, field):
    from contest_detective.server.research_pipeline.verification import _targets

    contest_id = seed(session, 1, date_claims=[{
        'field': field, 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日',
    }])
    now = datetime.fromisoformat('2026-10-27T02:00:00Z')
    assert [target.contest_id for target in _targets(session, now, 30)] == [contest_id]


@pytest.mark.parametrize(('value', 'precision', 'clock', 'expected'), [
    ('2026-10-26', 'day', '2026-10-27T02:00:00Z', False),
    ('2026-10-27', 'day', '2026-10-27T15:59:59Z', True),
    ('2026-10-27', 'day', '2026-10-27T16:00:00Z', False),
    ('2026-10-27T01:59:59Z', 'datetime', '2026-10-27T02:00:00Z', False),
    ('2026-10-27T02:00:00Z', 'datetime', '2026-10-27T02:00:00Z', True),
    ('2026-11-26T02:00:00Z', 'datetime', '2026-10-27T02:00:00Z', True),
    ('2026-11-26T02:00:01Z', 'datetime', '2026-10-27T02:00:00Z', False),
    ('2026-11-26', 'day', '2026-10-26T18:00:00Z', True),
])
def test_verification_window_intersects_day_ranges_and_exact_instants(session, value, precision, clock, expected):
    from contest_detective.server.research_pipeline.verification import _targets

    seed(session, 1, date_claims=[{
        'field': 'registration_deadline', 'value': value, 'precision': precision, 'excerpt': value,
    }])
    assert bool(_targets(session, datetime.fromisoformat(clock), 30)) is expected


def test_day_deadline_order_uses_the_calendar_interval_start(session):
    from contest_detective.server.research_pipeline.verification import _targets

    day = seed(session, 1, date_claims=[{
        'field': 'registration_deadline', 'value': '2026-11-01', 'precision': 'day', 'excerpt': '11月1日',
    }])
    exact = seed(session, 2, deadline=datetime.fromisoformat('2026-10-31T18:00:00Z'))
    now = datetime.fromisoformat('2026-10-27T02:00:00Z')
    assert [target.contest_id for target in _targets(session, now, 30)] == [day, exact]


def test_recent_selection_uses_future_deadlines_or_start_and_sorts_deadlines_first(session_factory):
    from contest_detective.server.research_pipeline.verification import verify_recent
    with session_factory() as session:
        late = seed(session, 1, deadline=NOW + timedelta(days=9))
        early = seed(session, 2, deadline=NOW + timedelta(days=1))
        start = seed(session, 3, start=NOW + timedelta(days=2))
        seed(session, 4, deadline=NOW - timedelta(days=1))
        seed(session, 5, start=NOW + timedelta(days=31))
        seed(session, 6, start=NOW + timedelta(days=3), url='https://hackertrip.space/registration')
    visited = []

    async def fetch(url):
        visited.append(url)
        return '正文'

    async def runner(url, **kwargs):
        assert kwargs['page_text'] == '正文'
        assert kwargs['registration_url'] == url
        assert kwargs['contest_id'] in {early, late, start}
        return None

    result = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        fetcher=fetch, runner=runner, now=NOW))
    assert visited == ['https://organizer.example/2', 'https://organizer.example/1', 'https://organizer.example/3']
    assert result.attempted == 3
    assert result.failed == 3


def test_verification_limits_unique_pages_and_isolates_fetch_errors(session_factory):
    from contest_detective.server.research_pipeline.verification import verify_recent
    with session_factory() as session:
        for number in range(35):
            seed(session, number, deadline=NOW + timedelta(hours=number + 1))
        seed(session, 36, deadline=NOW + timedelta(hours=1), url='https://organizer.example/0')
    visited = []

    async def fetch(url):
        visited.append(url)
        if url.endswith('/0'):
            raise RuntimeError('页面不可用')
        return '正文'

    async def runner(url, **kwargs):
        return None

    result = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        fetcher=fetch, runner=runner, now=NOW, limit=100))
    assert len(visited) == len(set(visited)) == 30
    assert result.attempted == result.failed == 30


def test_unchanged_text_skips_extraction_and_changed_text_updates_official_claim(session_factory, monkeypatch):
    from contest_detective.server.research_pipeline.verification import verify_recent
    monkeypatch.setattr(service, '_now', lambda: NOW)
    with session_factory() as session:
        contest_id = seed(session, 1, deadline=NOW + timedelta(days=2), start=NOW + timedelta(days=3))
    text = '活动 1 延期到 2026-11-10'
    calls = []

    async def fetch(url):
        return text

    async def extractor(url, body):
        calls.append(body)
        return ContestDraft(name='活动 1', page={'url': url, 'site': '主办方',
            'title': '延期公告', 'is_official': True}, claims=[
                {'field': 'start_at', 'value': '2026-11-10T00:00:00Z', 'excerpt': body}])

    async def runner(url, *, extractor, session_factory, page_text, registration_url, contest_id):
        draft = await extractor(url, page_text)
        with session_factory() as session:
            return service.save(session, draft, contest_id=contest_id)

    async def execute():
        return await verify_recent(session_factory=session_factory, extractor=extractor,
            fetcher=fetch, runner=runner, now=NOW)

    assert asyncio.run(execute()).verified == 1
    assert asyncio.run(execute()).unchanged == 1
    text = '活动 1 开赛仍是 2026-11-10，地点已公布'
    assert asyncio.run(execute()).verified == 1
    assert len(calls) == 2
    with session_factory() as session:
        detail = service.get(session, contest_id)
        assert detail.fields['start_at'].value == '2026-11-10T00:00:00Z'
        assert detail.fields['start_at'].level == 'official'
        assert next(source for source in detail.fields['start_at'].sources if not source.is_official).stale
        assert service.query(session, ContestQuery())[1] == 1
        assert session.scalar(select(ContestPage).where(ContestPage.url == 'https://organizer.example/1')).content_hash


def test_a_failed_extraction_does_not_cache_the_page_hash(session_factory):
    from contest_detective.server.research_pipeline.verification import verify_recent
    with session_factory() as session:
        seed(session, 1, deadline=NOW + timedelta(days=1))
    calls = []

    async def fetch(url):
        return '正文'

    async def runner(url, **kwargs):
        calls.append(url)
        raise RuntimeError('抽取失败')

    for _ in range(2):
        result = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
            fetcher=fetch, runner=runner, now=NOW))
        assert result.failed == 1
    assert len(calls) == 2


def test_explicit_contest_target_requires_an_existing_record(session):
    with pytest.raises(ValueError, match='赛事不存在'):
        service.save(session, ContestDraft(name='未知活动', page={'url': 'https://organizer.example/new',
            'site': '主办方', 'title': '活动', 'is_official': True}, claims=[]), contest_id='missing')


def test_sync_page_reader_is_supported_without_blocking_the_event_loop(session_factory):
    from contest_detective.server.research_pipeline.verification import verify_recent
    with session_factory() as session:
        seed(session, 1, deadline=NOW + timedelta(days=1))
    visited = []

    def fetch(url):
        visited.append(url)
        return '网页正文'

    async def runner(url, **kwargs):
        assert kwargs['page_text'] == '网页正文'
        return None

    result = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
        fetcher=fetch, runner=runner, now=NOW))
    assert visited == ['https://organizer.example/1']
    assert result.failed == 1


def test_real_single_page_pipeline_writes_postponement_back_to_selected_contest(session_factory, monkeypatch):
    from contest_detective.server.research_pipeline.verification import verify_recent
    monkeypatch.setattr(service, '_now', lambda: NOW)
    with session_factory() as session:
        contest_id = seed(session, 1, deadline=NOW + timedelta(days=2), start=NOW + timedelta(days=3))

    async def fetch(url):
        return '活动 1 主办方延期通知：比赛改为 2026-11-10 开赛。'

    async def extractor(url, body):
        return ContestDraft(name='活动 1', page={'url': 'https://invented.example',
            'site': '抽取结果', 'title': '活动', 'is_official': False}, claims=[
                {'field': 'start_at', 'value': '2026-11-10T00:00:00Z', 'excerpt': '比赛改为 2026-11-10 开赛'}])

    result = asyncio.run(verify_recent(session_factory=session_factory, extractor=extractor,
        fetcher=fetch, now=NOW))
    assert result.verified == 1
    assert result.failed == 0
    with session_factory() as session:
        detail = service.get(session, contest_id)
        assert detail.fields['start_at'].value == '2026-11-10T00:00:00Z'
        assert detail.fields['start_at'].level == 'official'
        assert len(detail.fields['start_at'].sources) == 2
        assert service.query(session, ContestQuery())[1] == 1
