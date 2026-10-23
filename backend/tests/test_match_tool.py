import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.contest.service import save
from contest_detective.server.user.schemas import Profile
from contest_detective.web.api.agent import get_investigator, limiter


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


def local_match_model(seen, *, arguments=None, instructions=None):
    def respond(messages, info):
        if instructions is not None:
            instructions.append(info.instructions)
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('match_contests', arguments or {})])
        result = results[-1].content
        seen.append(result)
        text = result['items'][0]['reason'] if result['items'] else result['summary']
        return ModelResponse([TextPart(text)])
    return FunctionModel(respond)


def ask(investigator, **kwargs):
    async def collect():
        return [event async for event in investigator.ask('我适合哪场比赛', **kwargs)]
    return asyncio.run(collect())


def test_anonymous_confirmed_profile_uses_real_matching_and_repository_evidence(session_factory):
    ids, seen = seed(session_factory), []
    profile = Profile(skills=['Python'], topics=['agent'], github_evidence=[{
        'name': 'weekend-agent', 'url': 'https://github.com/person/weekend-agent', 'topics': ['agent'],
    }])
    events = ask(Investigator(local_match_model(seen), session_factory=session_factory), profile=profile)
    assert events[-1].type == 'answer'
    assert seen[0]['items'][0]['contest']['id'] == ids['Python agent 黑客松']
    assert '1 个仓库' in events[-1].payload['content']
    assert events[-1].payload['sources'] == [{
        'title': 'weekend-agent', 'url': 'https://github.com/person/weekend-agent', 'site': 'GitHub',
    }]


def test_explicit_tool_preferences_override_the_confirmed_account_profile(session_factory):
    ids, seen = seed(session_factory), []
    investigator = Investigator(local_match_model(seen, arguments={'profile': {'skills': ['Rust']}}),
        session_factory=session_factory, profile_reader=lambda _: {'skills': ['Python']})
    events = ask(investigator, user_id='confirmed-user')
    assert events[-1].type == 'answer'
    assert seen[0]['items'][0]['contest']['id'] == ids['Rust 黑客松']
    assert 'Rust' in events[-1].payload['content']


def test_request_preferences_override_account_preferences(session_factory):
    ids, seen = seed(session_factory), []
    investigator = Investigator(local_match_model(seen), session_factory=session_factory,
                                profile_reader=lambda _: {'skills': ['Python']})
    events = ask(investigator, user_id='confirmed-user', profile=Profile(skills=['Rust']))
    assert events[-1].type == 'answer'
    assert seen[0]['items'][0]['contest']['id'] == ids['Rust 黑客松']


def test_no_effective_profile_requests_confirmation_without_personalization(session_factory):
    seed(session_factory)
    seen, instructions = [], []
    empty = Profile(github='person', available_time='周末有空')
    investigator = Investigator(local_match_model(seen, instructions=instructions), session_factory=session_factory,
                                profile_reader=lambda _: empty.model_dump(mode='json'))
    events = ask(investigator, user_id='empty-account')
    assert events[-1].type == 'answer'
    assert seen[0]['items'] == []
    assert '先确认画像' in events[-1].payload['content']
    assert all('用户已确认的画像' not in text for text in instructions)


def test_anonymous_http_profile_reaches_the_investigation(client, session_factory):
    def respond(_, info):
        return ModelResponse([TextPart('收到 Rust 画像。' if 'Rust' in info.instructions else '未收到画像。')])
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    response = client.post('/agent/ask', json={'question': '我适合哪场', 'profile': {'skills': ['Rust']}})
    assert response.headers['content-type'].startswith('text/event-stream')
    assert '收到 Rust 画像' in response.text


def test_profile_validation_happens_before_opening_the_stream(client, session_factory):
    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(lambda *_: ModelResponse([TextPart('未找到资料。')])), session_factory=session_factory)
    response = client.post('/agent/ask', json={'question': '我适合哪场', 'profile': {'skills': ['x'] * 51}})
    assert response.headers['content-type'].startswith('application/json')
    assert response.json()['code'] == 400


def test_large_profile_context_is_rejected_before_provider_or_balance_access(session_factory):
    from sqlalchemy import select
    from contest_detective.server.agent.budget import Budget
    from contest_detective.server.agent.config import LLMSettings
    from contest_detective.server.agent.llm import GuardedModel
    from contest_detective.server.agent.models import LLMUsage
    profile = Profile(skills=['Python'], github_evidence=[{
        'name': f'repository-{index}', 'url': f'https://github.com/person/repository-{index}',
        'topics': ['测' * 80] * 50,
    } for index in range(100)])
    async def forbidden_balance():
        pytest.fail('The oversized context must be rejected before checking a provider balance')
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    guarded = GuardedModel(FunctionModel(lambda *_: pytest.fail('The oversized context must not reach a provider')),
                           Budget(session_factory, settings), balance_reader=forbidden_balance)
    events = ask(Investigator(guarded, session_factory=session_factory), profile=profile)
    assert events[-1].type == 'error' and '上下文过长' in events[-1].payload['message']
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).all() == []


def test_local_function_model_factory_runs_the_profile_journey(session_factory):
    from fastapi.testclient import TestClient
    from serve_fake import create_fake_app
    seed(session_factory)
    app = create_fake_app(db_engine=session_factory.kw['bind'], session_factory=session_factory)
    with TestClient(app) as client:
        response = client.post('/agent/ask', json={
            'question': '我适合哪场比赛', 'profile': {'skills': ['Rust']},
        })
    assert '"tool": "match_contests"' in response.text
    assert 'event: answer' in response.text and 'Rust 黑客松' in response.text
