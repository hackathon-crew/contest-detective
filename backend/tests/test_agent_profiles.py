import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part

from contest_detective.agent.loop import Investigator
from contest_detective.contest.schemas import ContestDraft
from contest_detective.contest.service import save
from contest_detective.system.user.schemas import Profile
from contest_detective.bootstrap.api.agent import get_investigator, limiter


@pytest.fixture
def client(authenticated_client):
    return authenticated_client


@pytest.fixture(autouse=True)
def clear_limits():
    limiter.reset()
    yield
    limiter.reset()


def seed(session_factory):
    ids = {}
    with session_factory() as session:
        for name in ('Python agent 黑客松', 'Rust 黑客松'):
            ids[name] = save(session, ContestDraft(name=name, page={
                'url': 'https://organizer.example/' + name.split()[0], 'site': '主办方', 'title': name, 'is_official': True,
            }, claims=[{'field': 'start_at', 'value': '2099-11-10T01:00:00Z', 'excerpt': '未来举办'},
                       {'field': 'mode', 'value': 'online', 'excerpt': '线上参加'}]))
        session.commit()
    return ids


def ask(investigator, **kwargs):
    async def collect():
        return [event async for event in investigator.ask('我适合哪场比赛', **kwargs)]
    return asyncio.run(collect())


def test_authenticated_http_profile_reaches_the_investigation(client, session_factory):
    def respond(_, info):
        return ModelResponse([answer_part('收到 Rust 画像。' if 'Rust' in info.instructions else '未收到画像。')])
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    response = client.post('/agent/ask', json={'question': '我适合哪场', 'profile': {'skills': ['Rust']}})
    assert response.headers['content-type'].startswith('text/event-stream')
    assert '收到 Rust 画像' in response.text


def test_profile_validation_happens_before_opening_the_stream(client, session_factory):
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(lambda *_: ModelResponse([answer_part('未找到资料。')])), session_factory=session_factory)
    response = client.post('/agent/ask', json={'question': '我适合哪场', 'profile': {'skills': ['x'] * 51}})
    assert response.headers['content-type'].startswith('application/json')
    assert response.json()['code'] == 400


def test_large_profile_context_is_trimmed_and_investigation_continues(session_factory):
    from decimal import Decimal
    from sqlalchemy import select
    from pydantic_ai.usage import RequestUsage
    from contest_detective.agent.budget import Budget
    from contest_detective.agent.config import LLMSettings
    from contest_detective.agent.llm import GuardedModel
    from contest_detective.agent.models import LLMUsage
    profile = Profile(skills=['Python'], github_evidence=[{
        'name': f'repository-{index}', 'url': f'https://github.com/person/repository-{index}',
        'topics': ['测' * 80] * 50,
    } for index in range(100)])
    def respond(_, info):
        assert 'Python' in info.instructions
        assert len(info.instructions.encode()) < 65536
        return ModelResponse([answer_part('按 Python 条件继续查找比赛。')], usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def enough():
        return Decimal(100)
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    guarded = GuardedModel(FunctionModel(respond), Budget(session_factory, settings), balance_reader=enough)
    events = ask(Investigator(guarded, session_factory=session_factory), profile=profile)
    assert events[-1].type == 'answer' and 'Python' in events[-1].payload['content']
    assert len(profile.github_evidence) == 100
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).one().status == 'settled'


def test_local_function_model_factory_runs_the_profile_journey(session_factory):
    from fastapi.testclient import TestClient
    from serve_fake import create_fake_app
    seed(session_factory)
    app = create_fake_app(db_engine=session_factory.kw['bind'], session_factory=session_factory)
    with TestClient(app) as client:
        from account_helpers import authenticate_transport
        authenticate_transport(app, session_factory)
        response = client.post('/agent/ask', json={
            'question': '我适合哪场比赛', 'profile': {'skills': ['Rust']},
        })
    assert '"tool": "search_contests"' in response.text
    assert 'event: answer' in response.text and 'Rust 黑客松' in response.text
