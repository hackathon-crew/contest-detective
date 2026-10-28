import json
import threading
from types import SimpleNamespace

import pytest

from contest_detective.agent.rag import index
from contest_detective.bootstrap import source_sync
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft, ContestQuery, PageIn
from contest_detective.research import scheduler as scheduling


def save(factory):
    with factory() as session:
        service.save(session, ContestDraft(name='纸飞机',
            page=PageIn(url='https://organizer.example/rules', site='organizer', title='规则', is_official=True), claims=[]))


def test_cli_refreshes_index_after_contest_commit_and_survives_index_failure(session_factory, monkeypatch, capsys):
    monkeypatch.setattr(source_sync, 'SessionLocal', session_factory)
    monkeypatch.setattr(source_sync, 'init_db', lambda: None)
    for name in ('configured_extractor', 'configured_normalizer', 'configured_tavily', 'configured_detail_fetcher'):
        monkeypatch.setattr(source_sync, name, lambda *a: None)

    def pipeline(factory, **kwargs):
        save(factory)
        return SimpleNamespace(model_dump_json=lambda: json.dumps({'saved': 1}))

    observed = []

    def refresh(self, factory):
        with factory() as session:
            observed.append(service.query(session, ContestQuery())[1])
        raise TimeoutError('embedding endpoint unavailable')

    monkeypatch.setattr(source_sync, 'run_pipeline', pipeline)
    monkeypatch.setattr(index.EmbeddingIndexer, 'refresh', refresh)
    source_sync.main([])
    assert observed == [1]
    assert json.loads(capsys.readouterr().out) == {'saved': 1}
    with session_factory() as session:
        assert service.query(session, ContestQuery())[1] == 1


@pytest.mark.parametrize('daily', [False, True])
def test_scheduled_refresh_follows_committed_sync(session_factory, monkeypatch, daily):
    completed = threading.Event()
    observed = []

    def pipeline(factory, **kwargs):
        save(factory)

    def refresh():
        with session_factory() as session:
            observed.append(service.query(session, ContestQuery())[1])
        completed.set()

    monkeypatch.setattr(scheduling, 'run_pipeline', pipeline)
    from datetime import datetime
    daily_at = datetime.now(scheduling.SHANGHAI).strftime('%H:%M') if daily else ''
    scheduler = scheduling.start_scheduler(session_factory, 360, daily_at=daily_at, after_sync=refresh)
    try:
        assert completed.wait(timeout=3)
        assert observed == [1]
    finally:
        scheduler.shutdown(wait=True)
