import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.loop import Investigator
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft


@pytest.fixture
def selected_contest(session_factory):
    with session_factory() as session:
        return service.save(session, ContestDraft(name='已选定的科学挑战赛', summary='面向公开科学问题的比赛', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '参赛规则', 'is_official': True,
        }, claims=[{'field': 'eligibility', 'value': '高校学生可参加', 'excerpt': '高校学生可参加'}]))


def ask(investigator, **kwargs):
    async def collect():
        return [event async for event in investigator.ask('我能参加吗？', **kwargs)]
    return asyncio.run(collect())


def test_selected_contest_skips_discovery_and_keeps_web_research(session_factory, selected_contest):
    calls = []
    def respond(messages, info):
        tools = {tool.name for tool in info.function_tools}
        assert not tools.intersection({'search_contests', 'match_contests'})
        assert {'get_contest', 'web_search', 'fetch_page', 'record_page'} <= tools
        if not calls:
            assert selected_contest in info.instructions
            calls.append('get_contest')
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': selected_contest, 'fields': ['eligibility']})])
        returns = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        assert returns[-1].content['contest']['fields']['eligibility']['value'] == '高校学生可参加'
        return ModelResponse([TextPart('高校学生可参加。[参赛规则](https://host.example/rules)')])
    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *_, **__: [], fetch=lambda *_: '主办方原文', record=lambda *_, **__: None)
    events = ask(investigator, contest_id=selected_contest)
    assert events[-1].type == 'answer'
    assert [event.payload['tool'] for event in events if event.type == 'step'] == ['get_contest']
    assert events[-1].payload['sources'][0]['url'] == 'https://host.example/rules'


def test_invalid_selected_contest_fails_without_a_model_call(session_factory):
    def respond(*_):
        pytest.fail('Invalid selection must not fall back to discovery')
    events = ask(Investigator(FunctionModel(respond), session_factory=session_factory), contest_id='missing')
    assert events[-1].type == 'error'
    assert '比赛' in events[-1].payload['message']


def test_unbound_questions_keep_discovery_tools(session_factory):
    def respond(_, info):
        assert {'search_contests', 'match_contests'} <= {tool.name for tool in info.function_tools}
        return ModelResponse([TextPart('请看比赛资料')])
    assert ask(Investigator(FunctionModel(respond), session_factory=session_factory))[-1].type == 'answer'


def test_web_supplement_is_saved_to_selected_contest(session_factory, selected_contest):
    saved = []
    stage = 0
    def record(url, **kwargs):
        saved.append((url, kwargs['contest_id']))
        return selected_contest
    def respond(messages, info):
        nonlocal stage
        stages = [
            ToolCallPart('web_search', {'query': '已选定的科学挑战赛 最新参赛规则'}),
            ToolCallPart('fetch_page', {'url': 'https://host.example/update'}),
            ToolCallPart('record_page', {'url': 'https://host.example/update'}),
        ]
        if stage < len(stages):
            call = stages[stage]
            stage += 1
            return ModelResponse([call])
        return ModelResponse([TextPart('已读取补充规则')])
    events = ask(Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *_, **__: [], fetch=lambda *_: '科学挑战赛参赛规则：高校学生可参加', record=record), contest_id=selected_contest)
    assert events[-1].type == 'answer'
    assert saved == [('https://host.example/update', selected_contest)]
    assert [event.payload['tool'] for event in events if event.type == 'step'] == ['web_search', 'fetch_page', 'record_page']


def test_account_history_keeps_binding_in_followups_and_retries(authenticated_client, session_factory, selected_contest):
    from uuid import uuid4
    from contest_detective.bootstrap.api.agent import get_investigator
    browser = authenticated_client
    exposed = []
    def respond(_, info):
        exposed.append({tool.name for tool in info.function_tools})
        return ModelResponse([TextPart('参赛规则已整理')])
    browser.app.dependency_overrides[get_investigator] = lambda: Investigator(FunctionModel(respond), session_factory=session_factory)
    first_id = str(uuid4())
    first = {'question': '学生可以参加吗？', 'conversation_id': 'selected', 'turn_id': 'one',
             'investigation_id': first_id, 'contest_id': selected_contest}
    assert 'event: answer' in browser.post('/agent/ask', json=first).text
    retry_id = str(uuid4())
    assert 'event: answer' in browser.post('/agent/ask', json={**first,
        'investigation_id': retry_id, 'retry_of': first_id}).text
    assert 'event: answer' in browser.post('/agent/ask', json={
        'question': '那需要组队吗？', 'conversation_id': 'selected', 'turn_id': 'two'}).text
    history = browser.get('/account/conversations/selected').json()['data']
    assert [turn['request']['contest']['id'] for turn in history['turns']] == [selected_contest, selected_contest]
    assert all('search_contests' not in tools and 'match_contests' not in tools for tools in exposed)
    assert 'event: answer' in browser.post('/agent/ask', json={
        'question': '找其他线上比赛', 'conversation_id': 'selected', 'turn_id': 'three', 'contest_id': None}).text
    assert 'search_contests' in exposed[-1] and 'match_contests' in exposed[-1]
    assert browser.get('/account/conversations/selected').json()['data']['turns'][-1]['request'].get('contest') is None
    retry = {**first, 'investigation_id': str(uuid4()), 'retry_of': retry_id}
    retry.pop('contest_id')
    assert 'event: answer' in browser.post('/agent/ask', json=retry).text
    assert 'search_contests' not in exposed[-1]
    assert browser.get('/account/conversations/selected').json()['data']['turns'][0]['request']['contest']['id'] == selected_contest


def test_get_contest_cannot_switch_away_from_selection(session_factory, selected_contest):
    attempted = False
    def respond(messages, _):
        nonlocal attempted
        if not attempted:
            attempted = True
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': 'another', 'fields': ['prize']})])
        returned = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)][-1]
        assert 'contest' not in returned.content
        return ModelResponse([TextPart('继续围绕已选比赛查证')])
    assert ask(Investigator(FunctionModel(respond), session_factory=session_factory), contest_id=selected_contest)[-1].type == 'answer'
