import threading
from time import monotonic as time_monotonic

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.server.contest.service import query


def draft():
    return ContestDraft(name='公开测试黑客松', page=PageIn(
        url='https://example.org/contest', site='example.org', title='公开测试黑客松', is_official=False,
    ), claims=[ClaimIn(field='start_at', value='2027-01-01T00:00:00Z', excerpt='2027年1月1日')])


def test_sync_keeps_other_sources_running_and_does_not_log_credentials(session_factory, caplog):
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    def broken(_client):
        raise ValueError('Bearer do-not-log-this')

    settings = AppSettings(_env_file=None, sync_collect='structured')
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client, settings=settings, sources=[
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
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    settings = AppSettings(_env_file=None, sync_collect='structured')
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        first = run_pipeline(session_factory, client=client, settings=settings, sources=[('healthy', lambda _: [draft()])])
        second = run_pipeline(session_factory, client=client, settings=settings, sources=[('healthy', lambda _: [draft()])])

    assert first.saved == second.saved == 1
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 1


def test_daily_window_bounds_include_the_start_and_stop_at_the_end():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    from contest_detective.server.research_pipeline.scheduler import within_daily_window

    shanghai = ZoneInfo('Asia/Shanghai')
    start = datetime(2026, 10, 24, 3, 0, tzinfo=shanghai)
    assert within_daily_window(start, '03:00', 60)
    assert within_daily_window(start + timedelta(minutes=59), '03:00', 60)
    assert not within_daily_window(start + timedelta(minutes=60), '03:00', 60)
    assert not within_daily_window(start - timedelta(minutes=1), '03:00', 60)
    after_midnight = datetime(2026, 10, 24, 0, 10, tzinfo=shanghai)
    assert within_daily_window(after_midnight, '23:30', 90)
    assert not within_daily_window(after_midnight, '23:30', 30)
    from contest_detective.server.research_pipeline.scheduler import window_key
    assert window_key(after_midnight, '23:30', 90) == '2026-10-23'
    assert window_key(start + timedelta(minutes=60), '03:00', 60) is None


def test_daily_clock_rejects_values_that_are_not_hours_and_minutes():
    import pytest
    from pydantic import ValidationError
    from contest_detective.framework.config.app import AppSettings

    assert AppSettings(_env_file=None, sync_daily_at='').sync_daily_at == ''
    assert AppSettings(_env_file=None, sync_daily_at='03:00').sync_window_minutes == 60
    with pytest.raises(ValidationError):
        AppSettings(_env_file=None, sync_daily_at='25:00')


def test_daily_window_runs_once_when_the_process_starts_inside_it(session_factory, monkeypatch):
    from datetime import datetime, timedelta
    from contest_detective.server.research_pipeline import scheduler as scheduling

    completed = threading.Event()
    calls = []

    def one_round(factory, *, extractor=None):
        calls.append((factory, extractor))
        completed.set()

    monkeypatch.setattr(scheduling, 'run_pipeline', one_round)
    now = datetime.now(scheduling.SHANGHAI)
    scheduler = scheduling.start_scheduler(
        session_factory, 360, daily_at=now.strftime('%H:%M'), window_minutes=60,
    )
    try:
        assert completed.wait(timeout=3)
        deadline = time_monotonic() + 2
        job = scheduler.get_job('contest-source-sync')
        while job.next_run_time is None or job.next_run_time - datetime.now(scheduling.SHANGHAI) < timedelta(hours=20):
            if time_monotonic() > deadline:
                break
            threading.Event().wait(0.05)
            job = scheduler.get_job('contest-source-sync')
        assert job.next_run_time - datetime.now(scheduling.SHANGHAI) > timedelta(hours=20)
    finally:
        scheduler.shutdown(wait=True)
    assert calls == [(session_factory, None)]


def test_restart_inside_the_same_window_does_not_run_again(session_factory, monkeypatch):
    from datetime import datetime, timedelta
    from contest_detective.server.research_pipeline import scheduler as scheduling

    completed = threading.Event()
    calls = []

    def one_round(factory, *, extractor=None):
        calls.append(1)
        completed.set()

    monkeypatch.setattr(scheduling, 'run_pipeline', one_round)
    now = datetime.now(scheduling.SHANGHAI)
    daily_at = now.strftime('%H:%M')
    first = scheduling.start_scheduler(session_factory, 0, daily_at=daily_at, window_minutes=60)
    try:
        assert completed.wait(timeout=3)
    finally:
        first.shutdown(wait=True)

    def forbidden(*_args, **_kwargs):
        raise AssertionError('同一窗口重启不得再跑一轮')

    monkeypatch.setattr(scheduling, 'run_pipeline', forbidden)
    second = scheduling.start_scheduler(session_factory, 0, daily_at=daily_at, window_minutes=60)
    try:
        job = second.get_job('contest-source-sync')
        assert job.next_run_time - datetime.now(scheduling.SHANGHAI) > timedelta(hours=20)
    finally:
        second.shutdown(wait=False)
    assert calls == [1]


def test_daily_window_waits_when_the_process_starts_outside_it(session_factory, monkeypatch):
    from datetime import datetime, timedelta
    from apscheduler.triggers.cron import CronTrigger
    from contest_detective.server.research_pipeline import scheduler as scheduling

    def forbidden(*_args, **_kwargs):
        raise AssertionError('窗口外不得补跑同步')

    monkeypatch.setattr(scheduling, 'run_pipeline', forbidden)
    later = datetime.now(scheduling.SHANGHAI) + timedelta(hours=2)
    daily_at = later.strftime('%H:%M')
    scheduler = scheduling.start_scheduler(session_factory, 360, daily_at=daily_at, window_minutes=60)
    try:
        job = scheduler.get_job('contest-source-sync')
        upcoming = job.next_run_time.astimezone(scheduling.SHANGHAI)
        assert isinstance(job.trigger, CronTrigger)
        assert (upcoming.hour, upcoming.minute) == (later.hour, later.minute)
        assert upcoming - datetime.now(scheduling.SHANGHAI) > timedelta(minutes=59)
    finally:
        scheduler.shutdown(wait=False)


def test_daily_schedule_arms_page_extraction_in_the_same_run(session_factory, monkeypatch):
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.agent import extraction
    from contest_detective.web.bootstrap import app as bootstrap
    from contest_detective.web.bootstrap import source_sync

    settings = AppSettings(
        _env_file=None, sync_collect='both', sync_daily_at='03:00', sync_interval_minutes=360,
    )
    monkeypatch.setattr(bootstrap, 'get_app_settings', lambda: settings)
    monkeypatch.setattr(source_sync, 'get_app_settings', lambda: settings)
    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: SimpleNamespace(enabled=True))
    extractor = object()

    def create(*, session_factory):
        assert session_factory.kw['bind'] is session_factory_bind
        return extractor

    session_factory_bind = session_factory.kw['bind']
    monkeypatch.setattr(extraction, 'create_page_extractor', create)
    received = {}

    def start(factory, interval, *, extractor=None, daily_at='', window_minutes=60):
        received.update(interval=interval, daily_at=daily_at, window_minutes=window_minutes, extractor=extractor)
        return SimpleNamespace(shutdown=lambda *, wait: None)

    monkeypatch.setattr(bootstrap, 'start_scheduler', start)
    application = bootstrap.create_app(db_engine=session_factory_bind)
    with TestClient(application):
        pass
    assert received == {'interval': 360, 'daily_at': '03:00', 'window_minutes': 60, 'extractor': extractor}


def test_disabled_interval_does_not_start_a_scheduler(session_factory):
    from contest_detective.server.research_pipeline.scheduler import start_scheduler

    assert start_scheduler(session_factory, 0) is None
    with session_factory() as session:
        assert query(session, ContestQuery())[1] == 0


def test_interval_scheduler_runs_a_sync_immediately_and_can_stop(session_factory, monkeypatch):
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline import scheduler as scheduling

    completed = threading.Event()

    def one_round(factory, *, extractor=None):
        from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline
        with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
            report = run_pipeline(factory, client=client, extractor=extractor,
                                  settings=AppSettings(_env_file=None, sync_collect='structured'),
                                  sources=[('healthy', lambda _: [draft()])])
        completed.set()
        return report

    monkeypatch.setattr(scheduling, 'run_pipeline', one_round)
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

    monkeypatch.setattr(bootstrap, 'start_scheduler', lambda *_args, **_kwargs: Scheduler())
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
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    fixtures = Path(__file__).parent / 'fixtures'
    snapshots = {name: json.loads((fixtures / f'{name}.json').read_text(encoding='utf-8'))
                 for name in ('hackertrip', 'waytoagi', 'waytoagi_details', 'devpost')}

    def handle(request):
        if request.url.host == 'devpost.com':
            return httpx.Response(200, json=snapshots['devpost'].get(
                request.url.params['page'], {'hackathons': []}))
        if request.url.host == 'hackertrip.space':
            return httpx.Response(200, json=snapshots['hackertrip'])
        if request.url.path == '/api/events':
            return httpx.Response(200, json=snapshots['waytoagi'])
        return httpx.Response(200, json=snapshots['waytoagi_details'][request.url.path.rsplit('/', 1)[-1]])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        report = run_pipeline(session_factory, client=client,
                              settings=AppSettings(_env_file=None, sync_collect='structured'))
    assert report.saved == 111
    assert report.stage_counts['persist']['saved_pages'] == 113
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
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    initial = draft()
    initial.claims.append(ClaimIn(field='registration_url', value='https://organizer.example/register',
                                 excerpt='报名页 https://organizer.example/register'))

    async def body(_url):
        return '本届城市：上海'

    async def extractor(url, text):
        return ContestDraft(name=initial.name, page=PageIn(url=url, site='来源', title='赛事', is_official=False),
            claims=[ClaimIn(field='city', value='上海', excerpt='城市：上海')])

    settings = AppSettings(_env_file=None, sync_collect='both')
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        first = run_pipeline(session_factory, client=client, settings=settings,
                             sources=[('fixture', lambda _: [initial])], extractor=extractor,
                             fetcher=body, listings=[], searcher=lambda *_args, **_kwargs: [],
                             now=datetime(2026, 12, 25, tzinfo=timezone.utc))
        second = run_pipeline(session_factory, client=client, settings=settings,
                              sources=[('fixture', lambda _: [initial])], extractor=extractor,
                              fetcher=body, listings=[], searcher=lambda *_args, **_kwargs: [],
                              now=datetime(2026, 12, 25, tzinfo=timezone.utc))
    assert first.verified == 1
    assert second.verified == 0
    assert second.skipped == 1
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 1
        assert get(session, items[0].id).fields['city'].level == 'official'


def test_sync_with_no_extractor_does_not_start_discovery(session_factory):
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    def forbidden(*_args, **_kwargs):
        raise AssertionError('未配置抽取器时不得读取详情或调用模型')

    with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
        report = run_pipeline(session_factory, client=client, sources=[], listings=[('forbidden', forbidden)],
                              searcher=forbidden, settings=AppSettings(_env_file=None, sync_collect='both'))
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

    def start(factory, interval, *, extractor=None, daily_at='', window_minutes=60):
        received.append((factory.kw['bind'], interval, daily_at, window_minutes, extractor))
        return Scheduler()

    monkeypatch.setattr(bootstrap, 'start_scheduler', start)
    application = bootstrap.create_app(
        db_engine=session_factory.kw['bind'], sync_interval_minutes=360, sync_daily_at='',
        sync_window_minutes=60, sync_extractor=extractor,
    )
    with TestClient(application) as client:
        assert client.get('/health').json()['code'] == 200
    assert received == [(session_factory.kw['bind'], 360, '', 60, extractor)]
