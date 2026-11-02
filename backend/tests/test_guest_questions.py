from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
import time_machine
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from agent_responses import answer_part
from contest_detective.agent.chat.models import ChatConversation, ChatTurn
from contest_detective.agent.loop import Investigator
from contest_detective.agent.models import Investigation, TraceRecord
from contest_detective.bootstrap.api.guest import get_guest_investigator
from contest_detective.framework.db import init_db
from contest_detective.framework.exceptions import BizException
from contest_detective.system.user.guest import GuestQuestions


def test_three_guest_questions_replay_privacy_and_cookie_isolation(anonymous_client, session_factory):
    client = anonymous_client
    calls = []

    def respond(*_):
        calls.append(True)
        return ModelResponse([answer_part('可以继续查看官方比赛规则。')])

    client.app.dependency_overrides[get_guest_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    assert client.get('/agent/guest-quota').json()['data']['remaining'] == 3
    bodies = [{'investigation_id': str(uuid4()), 'question': '找线上比赛'} for _ in range(3)]
    for index, body in enumerate(bodies):
        assert 'event: answer' in client.post('/agent/guest/ask', json=body).text
        assert client.get('/agent/guest-quota').json()['data']['remaining'] == 2 - index
    assert 'event: answer' in client.post('/agent/guest/ask', json=bodies[0]).text
    assert len(calls) == 3
    assert client.post('/agent/guest/ask', json={**bodies[0], 'question': '换一个比赛'}).json()['code'] == 409
    rejected = client.post('/agent/guest/ask', json={'question': '还有哪些比赛'}).json()
    assert rejected['code'] == 429 and rejected['data']['action'] == 'login'
    assert rejected['data']['remaining'] == 0
    other = TestClient(client.app)
    try:
        assert other.get('/agent/guest-quota').json()['data']['remaining'] == 0
        assert client.cookies.get('cd_guest') != other.cookies.get('cd_guest')
        prefix = '/agent/guest/investigations/' + bodies[0]['investigation_id']
        assert other.get(prefix + '/events').json()['code'] == 404
        assert other.post(prefix + '/cancel').json()['code'] == 404
        client.cookies.clear()
        assert client.get('/agent/guest-quota').json()['data']['remaining'] == 0
        assert client.get(prefix + '/events').json()['code'] == 404
    finally:
        other.close()
    with session_factory() as session:
        for model in (Investigation, TraceRecord, ChatConversation, ChatTurn):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_concurrent_guest_questions_cannot_exceed_three(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "quota.db"}', connect_args={'check_same_thread': False})
    init_db(engine)
    sessions = sessionmaker(bind=engine)

    def consume(index):
        with sessions() as session:
            try:
                GuestQuestions(session).consume('127.0.0.1', str(index))
                session.commit()
                return 200
            except BizException as error:
                return error.code

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(consume, range(4))) == [200, 200, 200, 429]
    finally:
        engine.dispose()


def test_guest_quota_rejects_retired_ids_and_resets_at_beijing_midnight(session_factory):
    with time_machine.travel('2026-11-01T15:59:59Z', tick=False):
        with session_factory() as session:
            GuestQuestions(session).consume('127.0.0.1', 'retired-run')
            session.commit()
        with session_factory() as session:
            with pytest.raises(BizException) as rejected:
                GuestQuestions(session).consume('127.0.0.1', 'retired-run')
            assert rejected.value.code == 409
        with session_factory() as session:
            quota = GuestQuestions(session).quota('127.0.0.1')
            assert quota.remaining == 2 and quota.resets_at.isoformat() == '2026-11-02T00:00:00+08:00'
    with time_machine.travel('2026-11-01T16:00:00Z', tick=False):
        with session_factory() as session:
            assert GuestQuestions(session).quota('127.0.0.1').remaining == 3
