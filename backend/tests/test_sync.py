import threading

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.server.contest.service import query


def draft():
    return ContestDraft(name='公开测试黑客松', page=PageIn(
        url='https://example.org/contest', site='example.org', title='公开测试黑客松', is_official=False,
    ), claims=[ClaimIn(field='start_at', value='2027-01-01T00:00:00Z', excerpt='2027年1月1日')])


def test_sync_keeps_other_sources_running_and_does_not_log_credentials(session_factory, caplog):
    from contest_detective.server.research_pipeline.service import run_sync

    def broken(_client):
        raise ValueError('Bearer do-not-log-this')

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_sync(session_factory, client=client, sources=[
            ('broken', broken), ('healthy', lambda _: [draft()]),
        ])

    assert report.saved == 1
    assert report.failed == 1
    assert 'do-not-log-this' not in caplog.text
    with session_factory() as session:
        items, total = query(session, ContestQuery())
    assert total == 1
    assert items[0].name == '公开测试黑客松'


def test_sync_updates_existing_source_claims_without_duplicate_events(session_factory):
    from contest_detective.server.research_pipeline.service import run_sync

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        first = run_sync(session_factory, client=client, sources=[('healthy', lambda _: [draft()])])
        second = run_sync(session_factory, client=client, sources=[('healthy', lambda _: [draft()])])

    assert first.saved == second.saved == 1
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 1


def test_disabled_interval_does_not_start_a_scheduler(session_factory):
    from contest_detective.server.research_pipeline.scheduler import start_scheduler

    assert start_scheduler(session_factory, 0) is None
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 0


def test_interval_scheduler_runs_a_sync_immediately_and_can_stop(session_factory, monkeypatch):
    from contest_detective.server.research_pipeline import scheduler as scheduling
    from contest_detective.server.research_pipeline.service import run_sync

    completed = threading.Event()

    def one_round(factory):
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
            report = run_sync(factory, client=client, sources=[('healthy', lambda _: [draft()])])
        completed.set()
        return report

    monkeypatch.setattr(scheduling, 'run_sync', one_round)
    scheduler = scheduling.start_scheduler(session_factory, 360)
    try:
        assert completed.wait(timeout=3)
        with session_factory() as session:
            assert query(session, ContestQuery())[1] == 1
    finally:
        scheduler.shutdown(wait=True)
    assert scheduler.running is False


def test_application_stops_its_scheduler_when_lifespan_ends(session_factory, monkeypatch):
    from fastapi.testclient import TestClient
    from contest_detective.web.bootstrap import app as bootstrap

    stopped = threading.Event()

    class Scheduler:
        def shutdown(self, *, wait):
            assert wait is True
            stopped.set()

    monkeypatch.setattr(bootstrap, 'start_scheduler', lambda *_: Scheduler())
    application = bootstrap.create_app(db_engine=session_factory.kw['bind'], sync_interval_minutes=360)
    with TestClient(application) as client:
        assert client.get('/health').json()['data']['status'] == 'ok'
        assert not stopped.is_set()
    assert stopped.is_set()


def test_default_public_source_fixtures_reach_the_real_contest_store(session_factory):
    import json
    from pathlib import Path
    from sqlalchemy import func, select
    from contest_detective.server.contest.models import ContestPage
    from contest_detective.server.contest.service import get
    from contest_detective.server.research_pipeline.service import run_sync

    fixtures = Path(__file__).parent / 'fixtures'
    snapshots = {name: json.loads((fixtures / f'{name}.json').read_text())
                 for name in ('hackertrip', 'waytoagi', 'waytoagi_details', 'devpost')}

    def handle(request):
        if request.url.host == 'devpost.com':
            return httpx.Response(200, json=snapshots['devpost'][request.url.params['page']])
        if request.url.host == 'hackertrip.space':
            return httpx.Response(200, json=snapshots['hackertrip'])
        if request.url.path == '/api/events':
            return httpx.Response(200, json=snapshots['waytoagi'])
        return httpx.Response(200, json=snapshots['waytoagi_details'][request.url.path.rsplit('/', 1)[-1]])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        report = run_sync(session_factory, client=client)
    assert report.saved == 113
    assert report.failed == 0
    with session_factory() as session:
        first, total = query(session, ContestQuery(page_size=100))
        second, second_total = query(session, ContestQuery(page=2, page_size=100))
        items = first + second
        assert total == second_total == len(items) > 0
        assert session.scalar(select(func.count()).select_from(ContestPage)) == 113
        evidence = [source for item in items for field in get(session, item.id).fields.values()
                    for source in field.sources]
    assert any(source.url.startswith('https://hackertrip.space/hackathon/') for source in evidence)
    assert any(source.url.startswith('https://events.waytoagi.com/events/') for source in evidence)
    assert any('devpost.com' in source.url for source in evidence)
    assert all(source.excerpt and source.value for source in evidence)


def test_sync_checks_organizer_evidence_after_saving_and_reuses_unchanged_hashes(session_factory):
    from datetime import datetime, timezone
    from functools import partial
    from contest_detective.server.contest.service import get
    from contest_detective.server.research_pipeline.service import run_sync
    from contest_detective.server.research_pipeline.verification import verify_recent

    initial = draft()
    initial.claims.append(ClaimIn(field='registration_url', value='https://organizer.example/register',
                                 excerpt='报名页 https://organizer.example/register'))

    async def body(_url):
        return '本届城市：上海'

    async def extractor(url, text):
        return ContestDraft(name=initial.name, page=PageIn(url=url, site='来源', title='赛事', is_official=False),
            claims=[ClaimIn(field='city', value='上海', excerpt='城市：上海')])

    verifier = partial(verify_recent, fetcher=body, now=datetime(2026, 12, 25, tzinfo=timezone.utc))
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        first = run_sync(session_factory, client=client, sources=[('fixture', lambda _: [initial])],
                         extractor=extractor, discoveries=[], verifier=verifier)
        second = run_sync(session_factory, client=client, sources=[('fixture', lambda _: [initial])],
                          extractor=extractor, discoveries=[], verifier=verifier)
    assert first.extraction_enabled is True
    assert first.verified == 1
    assert second.verified == 0
    assert second.skipped == 1
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 1
        assert get(session, items[0].id).fields['city'].level == 'official'


def test_sync_with_no_extractor_does_not_start_discovery(session_factory):
    from contest_detective.server.research_pipeline.service import run_sync

    async def forbidden(**kwargs):
        raise AssertionError('未配置抽取器时不得读取详情或调用模型')

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_sync(session_factory, client=client, sources=[], discoveries=[('forbidden', forbidden)],
                          verifier=forbidden)
    assert report.extraction_enabled is False
    assert report.saved == report.verified == report.failed == 0


def test_application_passes_an_injected_extractor_to_background_sync(session_factory, monkeypatch):
    from fastapi.testclient import TestClient
    from contest_detective.web.bootstrap import app as bootstrap

    received = []

    async def extractor(url, text):
        raise AssertionError('装配测试不应调用抽取器')

    class Scheduler:
        def shutdown(self, *, wait):
            assert wait is True

    def start(factory, interval, *, extractor=None):
        received.append((factory.kw['bind'], interval, extractor))
        return Scheduler()

    monkeypatch.setattr(bootstrap, 'start_scheduler', start)
    application = bootstrap.create_app(db_engine=session_factory.kw['bind'], sync_interval_minutes=360,
                                       sync_extractor=extractor)
    with TestClient(application) as client:
        assert client.get('/health').json()['code'] == 200
    assert received == [(session_factory.kw['bind'], 360, extractor)]
