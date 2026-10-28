import asyncio
import json
from uuid import uuid4

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import select

from agent_responses import answer_part
from contest_detective.agent.loop import Investigator
from contest_detective.agent.models import Investigation, TraceRecord


def test_disconnect_for_ten_seconds_does_not_cancel_and_replays_from_database(session_factory):
    async def scenario():
        released = asyncio.Event()
        calls = 0

        async def fetch(_):
            await released.wait()
            return '报名截止为十月三十一日。'

        def respond(*_):
            nonlocal calls
            calls += 1
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})]
                                 if calls == 1 else [answer_part('报名截止为十月三十一日。')])

        investigator = Investigator(FunctionModel(respond), session_factory=session_factory, fetch=fetch)
        stream = investigator.ask('查一下比赛报名截止')
        assert (await anext(stream)).type == 'step'
        await stream.aclose()
        with session_factory() as session:
            row = session.scalars(select(Investigation)).one()
            investigation_id = row.id
            assert row.status == 'running'
        await asyncio.sleep(10)
        released.set()
        from contest_detective.agent.investigations import Investigations
        # A new reader has no task references or in-memory events.
        reader = Investigations(session_factory)
        events = [event async for event in reader.events(investigation_id, None, after=1)]
        assert [event.type for event in events] == ['observation', 'answer']
        assert [event.seq for event in events] == [2, 3]
        assert events[-1].payload['content'] == '报名截止为十月三十一日。'
        assert not any(event.type == 'error' for event in events)

    asyncio.run(scenario())


def test_event_reads_are_owned_and_honor_last_event_id(client, session_factory, monkeypatch):
    async def identity(request):
        return request.headers.get('test-user')
    monkeypatch.setattr('contest_detective.bootstrap.api.agent.get_current_user_id', identity)
    investigation_id = str(uuid4())
    with session_factory() as session:
        session.add(Investigation(id=investigation_id, question='报名时间', user_id='alice', status='completed'))
        session.add_all([
            TraceRecord(investigation_id=investigation_id, seq=1, type='step', payload={'tool': 'fetch_page', 'label': '读取网页'}),
            TraceRecord(investigation_id=investigation_id, seq=2, type='answer', payload={'content': '完整答案', 'sources': []}),
        ])
        session.commit()
    url = f'/agent/investigations/{investigation_id}/events'
    response = client.get(url, headers={'test-user': 'alice', 'Last-Event-ID': '1'})
    assert 'event: answer' in response.text and 'event: step' not in response.text
    assert 'id: 2' in response.text
    assert client.get(url, headers={'test-user': 'bob'}).json()['code'] == 404
    assert client.get(url).json()['code'] == 404
    assert client.post(f'/agent/investigations/{investigation_id}/cancel', headers={'test-user': 'bob'}).json()['code'] == 404


def test_stop_cancels_the_running_tool_and_persists_terminal_state(session_factory):
    async def scenario():
        from contest_detective.agent.investigations import Investigations
        from contest_detective.agent.schemas import AskRequest
        started, stopped = asyncio.Event(), asyncio.Event()

        async def fetch(_):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

        investigator = Investigator(FunctionModel(lambda *_: ModelResponse([
            ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])),
            session_factory=session_factory, fetch=fetch)
        runs = Investigations(session_factory)
        investigation_id = runs.start(investigator, AskRequest(question='查比赛'), 'alice', 'alice')
        await started.wait()
        await runs.cancel(investigation_id, 'alice')
        assert stopped.is_set()
        with session_factory() as session:
            assert session.get(Investigation, investigation_id).status == 'cancelled'
        events = [event async for event in runs.events(investigation_id, 'alice')]
        assert events[-1].type == 'error' and events[-1].payload['message'] == '查证已停止。'

    asyncio.run(scenario())


def test_restart_persists_retry_action_with_original_question(session_factory):
    from fastapi.testclient import TestClient
    from contest_detective.bootstrap.app import create_app
    from contest_detective.framework.db import get_session
    from contest_detective.bootstrap.api.agent import get_request_user_id
    investigation_id = str(uuid4())
    with session_factory() as session:
        session.add(Investigation(id=investigation_id, question='原问题：比赛报名时间', user_id='alice', status='running'))
        session.commit()
    app = create_app(db_engine=session_factory.kw['bind'], sync_interval_minutes=0, sync_daily_at='')
    def sessions():
        with session_factory() as session:
            yield session
    app.dependency_overrides[get_session] = sessions
    app.dependency_overrides[get_request_user_id] = lambda: 'alice'
    with TestClient(app) as restarted:
        response = restarted.get(f'/agent/investigations/{investigation_id}/events')
        payload = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith('data: ')))
        assert payload['action'] == 'retry'
        assert '一键重查' in payload['message']
    with session_factory() as session:
        row = session.get(Investigation, investigation_id)
        assert row.status == 'interrupted' and row.question == '原问题：比赛报名时间'


def test_repeated_start_is_idempotent_and_guest_cookie_owns_the_result(client, session_factory, monkeypatch):
    calls = []
    def create(**_):
        calls.append('create')
        return Investigator(FunctionModel(lambda *_: ModelResponse([answer_part('完整答案')])), session_factory=session_factory)
    monkeypatch.setattr('contest_detective.bootstrap.api.agent.create_investigator', create)
    investigation_id = str(uuid4())
    body = {'investigation_id': investigation_id, 'question': '查比赛'}
    first = client.post('/agent/ask', json=body)
    assert 'event: answer' in first.text
    assert client.cookies.get('cd_investigator')
    assert client.post('/agent/ask', json=body).text == first.text
    assert calls == ['create']
    assert '完整答案' in client.get(f'/agent/investigations/{investigation_id}/events?after=0').text
    client.cookies.clear()
    assert client.get(f'/agent/investigations/{investigation_id}/events').json()['code'] == 404
    assert client.post(f'/agent/investigations/{investigation_id}/cancel').json()['code'] == 404
