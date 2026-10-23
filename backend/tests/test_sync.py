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


def test_two_public_source_fixtures_reach_the_real_contest_store(session_factory):
    import json
    from pathlib import Path
    from sqlalchemy import func, select
    from contest_detective.server.contest.models import ContestPage
    from contest_detective.server.contest.service import get
    from contest_detective.server.research_pipeline.service import run_sync
    from contest_detective.server.research_pipeline.sources import hackertrip, waytoagi

    fixtures = Path(__file__).parent / 'fixtures'
    snapshots = {name: json.loads((fixtures / f'{name}.json').read_text())
                 for name in ('hackertrip', 'waytoagi', 'waytoagi_details')}

    def handle(request):
        if request.url.host == 'hackertrip.space':
            return httpx.Response(200, json=snapshots['hackertrip'])
        if request.url.path == '/api/events':
            return httpx.Response(200, json=snapshots['waytoagi'])
        return httpx.Response(200, json=snapshots['waytoagi_details'][request.url.path.rsplit('/', 1)[-1]])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        report = run_sync(session_factory, client=client, sources=[
            ('hackertrip', hackertrip.fetch), ('waytoagi', waytoagi.fetch),
        ])
    assert report.saved == 68
    assert report.failed == 0
    with session_factory() as session:
        items, total = query(session, ContestQuery(page_size=100))
        assert total == len(items) > 0
        assert session.scalar(select(func.count()).select_from(ContestPage)) == 68
        evidence = [source for item in items for field in get(session, item.id).fields.values()
                    for source in field.sources]
    assert any(source.url.startswith('https://hackertrip.space/hackathon/') for source in evidence)
    assert any(source.url.startswith('https://events.waytoagi.com/events/') for source in evidence)
    assert all(source.excerpt and source.value for source in evidence)
