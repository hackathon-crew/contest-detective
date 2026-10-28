import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from sqlalchemy import select

from contest_detective.agent.loop import Investigator
from contest_detective.agent.models import Investigation
from contest_detective.bootstrap.api.agent import get_investigator, limiter


@pytest.fixture
def client(authenticated_client):
    return authenticated_client


@pytest.fixture(autouse=True)
def clear_limits(monkeypatch):
    from contest_detective.framework.config.app import get_app_settings
    monkeypatch.setattr(get_app_settings(), "query_limits_enabled", True)
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def local_client(client, session_factory):
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(lambda *_: ModelResponse([answer_part('库中暂未找到符合条件的比赛。')])),
        session_factory=session_factory)
    yield client
    client.app.dependency_overrides.pop(get_investigator)


def test_event_stream_contains_answer_and_uses_no_buffering(local_client, session_factory):
    response = local_client.post('/agent/ask', json={'question': '找比赛'})
    assert response.headers['content-type'].startswith('text/event-stream')
    assert response.headers['x-accel-buffering'] == 'no'
    assert 'event: answer' in response.text
    data = [line[6:] for line in response.text.splitlines() if line.startswith('data: ')]
    assert json.loads(data[0])['content'] == '库中暂未找到符合条件的比赛。'
    with session_factory() as session:
        assert session.scalars(select(Investigation)).one().status == 'completed'


def test_minute_limit_returns_business_json_before_stream(local_client, session_factory):
    for _ in range(5):
        assert 'event: answer' in local_client.post('/agent/ask', json={'question': '找比赛'}).text
    rejected = local_client.post('/agent/ask', json={'question': '找比赛'})
    assert rejected.status_code == 200
    assert rejected.headers['content-type'].startswith('application/json')
    assert rejected.json()['code'] == 429
    with session_factory() as session:
        assert len(session.scalars(select(Investigation)).all()) == 5


def test_different_ips_do_not_share_the_same_limit(local_client):
    for _ in range(5):
        local_client.post('/agent/ask', json={'question': '找比赛'})
    with TestClient(local_client.app, client=('203.0.113.9', 52000)) as other:
        response = other.post('/agent/ask', json={'question': '找比赛'})
        assert response.headers['content-type'].startswith('text/event-stream')


def test_daily_limit_survives_minute_window_expiry(local_client, monkeypatch):
    import limits.storage.memory as memory
    clock = [1000000.0]
    monkeypatch.setattr(memory, 'time', SimpleNamespace(time=lambda: clock[0]))
    for _ in range(6):
        for _ in range(5):
            assert 'event: answer' in local_client.post('/agent/ask', json={'question': '找比赛'}).text
        clock[0] += 61
    rejected = local_client.post('/agent/ask', json={'question': '找比赛'})
    assert rejected.json()['code'] == 429
    clock[0] += 86401
    assert 'event: answer' in local_client.post('/agent/ask', json={'question': '找比赛'}).text


def test_parameter_errors_remain_json_and_do_not_start_investigation(local_client, session_factory):
    for question in ['', ' ' * 8]:
        response = local_client.post('/agent/ask', json={'question': question})
        assert response.json()['code'] == 400
        assert response.headers['content-type'].startswith('application/json')
    with session_factory() as session:
        assert session.scalars(select(Investigation)).all() == []


def test_disabled_provider_remains_json_and_validates_question_first(client, monkeypatch):
    from contest_detective.agent.config import LLMSettings
    import contest_detective.agent.llm as llm
    monkeypatch.setattr(llm, 'get_llm_settings', lambda: LLMSettings(_env_file=None, enabled=False))
    invalid = client.post('/agent/ask', json={'question': '   '})
    assert invalid.headers['content-type'].startswith('application/json')
    assert invalid.json()['code'] == 400
    disabled = client.post('/agent/ask', json={'question': '找比赛'})
    assert disabled.status_code == 200
    assert disabled.headers['content-type'].startswith('application/json')
    assert disabled.json()['code'] == 503
    assert 'event:' not in disabled.text


def test_campaign_switch_removes_query_count_cap(local_client, monkeypatch):
    from contest_detective.framework.config.app import get_app_settings
    monkeypatch.setattr(get_app_settings(), 'query_limits_enabled', False)
    for _ in range(7):
        assert 'event: answer' in local_client.post('/agent/ask', json={'question': '找比赛'}).text


@pytest.mark.parametrize('mode', ['deep', 'realtime'])
def test_legacy_strict_request_uses_normal_workflow_without_plans_or_claim_report(client, session_factory, monkeypatch, mode):
    from pydantic_ai.messages import ToolCallPart, ToolReturnPart
    from contest_detective.contest.service import save
    from contest_detective.contest.schemas import ContestDraft
    from contest_detective.agent.config import LLMSettings
    from contest_detective.system.account.schemas import SearchPreferences
    from contest_detective.framework.config.search import SearchSettings
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='公开开发挑战赛', page={
            'url': 'https://organizer.example/rules', 'site': '主办方', 'title': '规则', 'is_official': True,
        }, claims=[{'field': 'prize', 'value': '公开奖金', 'excerpt': '公开奖金'},
                   {'field': 'submission_deadline', 'value': '2027-12-31', 'precision': 'day', 'excerpt': '2027年12月31日截止'}]))
    def respond(messages, info):
        assert not {'plan_investigation', 'cite_evidence'} & {tool.name for tool in info.function_tools}
        assert '严格实时/深度核验' not in info.instructions
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('search_contests', {})])
        assert results[-1].content['items'][0]['id'] == contest_id
        return ModelResponse([answer_part('可以先看公开开发挑战赛，含金量尚需按你的目标比较。', [{
            'contest_id': contest_id, 'introduction': '公开赛事', 'reason': '请参考主办方规则',
        }])])
    monkeypatch.setattr('contest_detective.agent.llm.create_model', lambda **_: FunctionModel(respond))
    monkeypatch.setattr('contest_detective.bootstrap.api.agent.runtime_for', lambda *_: SimpleNamespace(
        llm=LLMSettings(_env_file=None), search=SearchSettings(_env_file=None), preferences=SearchPreferences()))
    response = client.post('/agent/ask', json={'question': '帮我找找最近含金量最高的比赛', 'mode': mode})
    assert response.headers['content-type'].startswith('text/event-stream')
    assert 'event: answer' in response.text
    assert 'plan_investigation' not in response.text
    data = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    answer = data[-1]
    assert 'report' not in answer
    assert answer['recommendations'][0]['contest']['id'] == contest_id


def test_confirmed_screenshot_claims_are_paused_before_model_initialization(client, monkeypatch):
    monkeypatch.setattr('contest_detective.agent.llm.create_model', lambda **_: pytest.fail('paused verification must not run model'))
    response = client.post('/agent/ask', json={'question': '核实截图', 'mode': 'deep',
        'confirmed_claims': [{'id': 'c1', 'text': '比赛报名今天截止', 'origin': 'screenshot'}]})
    assert response.json()['code'] == 503
    assert '暂时停用' in response.json()['message']
    assert 'event:' not in response.text
