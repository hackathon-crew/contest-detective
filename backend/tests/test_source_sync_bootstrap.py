import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from contest_detective.framework.config.app import AppSettings
from contest_detective.server.contest.schemas import ContestQuery
from contest_detective.server.contest.service import query
from contest_detective.web.bootstrap import source_sync


@pytest.mark.parametrize(('collect', 'llm_enabled', 'expected'), [
    ('structured', False, False),
    ('structured', True, False),
    ('both', False, False),
    ('both', True, True),
    (None, True, True),
])
def test_extractor_requires_unstructured_collection_and_a_model(
    session_factory, monkeypatch, collect, llm_enabled, expected,
):
    from contest_detective.server.agent import extraction

    monkeypatch.delenv('DETECTIVE_SYNC_COLLECT', raising=False)
    settings = AppSettings(_env_file=None, **(
        {} if collect is None else {'sync_collect': collect}
    ))
    monkeypatch.setattr(source_sync, 'get_app_settings', lambda: settings)
    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: SimpleNamespace(enabled=llm_enabled))
    extractor = object()

    def create(*, session_factory):
        assert expected, 'disabled source extraction must not construct a model extractor'
        assert session_factory is factory
        return extractor

    factory = session_factory
    monkeypatch.setattr(extraction, 'create_page_extractor', create)
    assert source_sync.configured_extractor(factory) is (extractor if expected else None)


def test_environment_switch_stops_before_reading_model_configuration(monkeypatch):
    monkeypatch.setenv('DETECTIVE_SYNC_COLLECT', 'structured')
    monkeypatch.setattr(source_sync, 'get_app_settings', lambda: AppSettings(_env_file=None))

    def forbidden():
        raise AssertionError('structured collection must not configure a model')

    monkeypatch.setattr(source_sync, 'get_llm_settings', forbidden)
    assert source_sync.configured_extractor(object()) is None


def test_configured_normalizer_passes_production_session_factory(monkeypatch):
    from contest_detective.server.agent import normalization

    settings = normalization.LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    marker = object()
    captured = {}

    def create(settings, **kwargs):
        captured['settings'] = settings
        captured.update(kwargs)
        return marker

    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: settings)
    monkeypatch.setattr(normalization, 'create_normalizer', create)

    assert source_sync.configured_normalizer() is marker
    assert captured['settings'] is settings
    assert captured['session_factory'] is source_sync.SessionLocal


@pytest.mark.parametrize('entrypoint', ['cli', 'scheduled'])
def test_disabled_extraction_keeps_structured_sync_without_discovery_or_verification(
    session_factory, monkeypatch, capsys, entrypoint,
):
    from contest_detective.server.agent import extraction
    from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline
    from contest_detective.web.bootstrap import app as bootstrap

    settings = AppSettings(_env_file=None, sync_collect='structured', sync_interval_minutes=360)
    monkeypatch.setattr(source_sync, 'get_app_settings', lambda: settings)
    monkeypatch.setattr(bootstrap, 'get_app_settings', lambda: settings)
    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: SimpleNamespace(enabled=True))

    def forbidden(*args, **kwargs):
        raise AssertionError('disabled extraction must not construct or invoke extraction work')

    monkeypatch.setattr(extraction, 'create_page_extractor', forbidden)
    drafts = [ContestDraft(name=name, page=PageIn(
        url=f'https://example.org/{index}', site=source, title=name, is_official=False,
    ), claims=[ClaimIn(field='start_at', value='2027-01-01T00:00:00Z', excerpt='2027年1月1日')])
        for index, (source, name) in enumerate([
            ('hackertrip', '北方开源竞赛'), ('waytoagi', '南方设计赛事'), ('devpost', '云端产品挑战'),
        ])]
    reports = []

    def sync(factory, *, extractor=None, detail_fetcher=None):
        with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
            report = run_pipeline(factory, client=client, extractor=extractor, settings=settings,
                sources=[(draft.page.site, lambda _, draft=draft: [draft]) for draft in drafts],
                listings=[('forbidden', forbidden)], searcher=forbidden)
        reports.append(report)
        return report

    if entrypoint == 'cli':
        monkeypatch.setattr(source_sync, 'SessionLocal', session_factory)
        monkeypatch.setattr(source_sync, 'init_db', lambda: None)
        monkeypatch.setattr(source_sync, 'run_pipeline', sync)
        source_sync.main()
        output = json.loads(capsys.readouterr().out)
        assert output['saved'] == 3
    else:
        stopped = []

        def start(factory, interval, *, extractor=None, daily_at='', window_minutes=60):
            assert interval == 360
            assert daily_at == ''
            assert window_minutes == 60
            sync(factory, extractor=extractor)
            return SimpleNamespace(shutdown=lambda *, wait: stopped.append(wait))

        monkeypatch.setattr(bootstrap, 'start_scheduler', start)
        application = bootstrap.create_app(db_engine=session_factory.kw['bind'])
        with TestClient(application):
            pass
        assert stopped == [True]

    assert reports[0].saved == 3
    assert reports[0].verified == reports[0].failed == 0
    with session_factory() as session:
        items, total = query(session, ContestQuery())
    assert total == 3
    assert {item.name for item in items} == {'北方开源竞赛', '南方设计赛事', '云端产品挑战'}
