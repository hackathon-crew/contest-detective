import asyncio
import json

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from pydantic_ai.usage import RequestUsage
from sqlalchemy import select

from contest_detective.server.agent.budget import Budget
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.agent.llm import GuardedModel
from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.models import Investigation, LLMUsage
from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ContestDraft


def seed(factory, name='已核对的比赛'):
    with factory() as session:
        contest_id = service.save(session, ContestDraft(name=name, page={
            'url': 'https://organizer.example/rules', 'site': '主办方', 'title': name, 'is_official': True,
        }, claims=[{'field': 'city', 'value': '北京', 'excerpt': '北京'}]))
        session.commit()
        return contest_id


def run(investigator):
    async def consume():
        return [event async for event in investigator.ask('继续核实参赛信息')]
    return asyncio.run(consume())


@pytest.mark.parametrize('tool', ['fetch_page', 'record_page', 'web_search'])
def test_one_unavailable_tool_can_be_followed_by_another_lookup(session_factory, tool):
    contest_id = seed(session_factory)
    calls = 0
    def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls in (1, 3):
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id})])
        if calls == 2:
            args = {'query': '比赛官网'} if tool == 'web_search' else {'url': 'https://organizer.example/extra'}
            return ModelResponse([ToolCallPart(tool, args)])
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        failed = next(part.content for part in results if part.tool_name == tool)
        assert failed['error'] and 'private-key-value' not in json.dumps(failed)
        return ModelResponse([answer_part('已查到北京的比赛，额外页面尚未核实。')])

    async def unavailable(*args, **kwargs):
        raise httpx.ReadTimeout('private-key-value')

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory,
                             fetch=unavailable, record=unavailable, search=unavailable))
    assert events[-1].type == 'answer', events[-1].payload
    assert sum(event.type == 'observation' for event in events) == 3
    with session_factory() as session:
        row = session.scalars(select(Investigation)).one()
        assert row.status == 'completed' and '北京' in row.answer


def test_later_model_failure_still_delivers_known_sources(session_factory):
    contest_id = seed(session_factory)
    calls = 0
    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id})])
        raise httpx.ReadTimeout('private-key-value')
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory))
    assert events[-1].type == 'answer', events[-1].payload
    assert events[-1].payload['sources'][0]['url'] == 'https://organizer.example/rules'
    assert '已核对的比赛' in events[-1].payload['content']
    assert 'private-key-value' not in json.dumps(events[-1].payload)
    with session_factory() as session:
        assert session.scalars(select(Investigation)).one().status == 'completed'


def test_external_usage_gap_does_not_discard_a_valid_answer(session_factory):
    settings = LLMSettings(_env_file=None, enabled=True, limits_mode='external', api_key='test-only')
    model = GuardedModel(FunctionModel(lambda *_: ModelResponse([answer_part('已有完整答复，报名时刻未核实。')],
                         usage=RequestUsage(unmeasured_requests=1))), Budget(session_factory, settings))
    events = run(Investigator(model, session_factory=session_factory))
    assert events[-1].type == 'answer', events[-1].payload
    assert events[-1].payload['content'] == '已有完整答复，报名时刻未核实。'
    with session_factory() as session:
        usage = session.scalars(select(LLMUsage)).one()
        assert usage.status == 'reserved' and usage.cost_cny == usage.reserved_cny > 0


def test_database_tool_can_continue_to_the_next_page(session_factory):
    expected = {seed(session_factory, f'分页比赛 {i}') for i in range(11)}
    seen = set()
    def respond(messages, info):
        results = [part.content for message in messages for part in message.parts
                   if isinstance(part, ToolReturnPart) and part.tool_name == 'search_contests']
        if results:
            latest = results[-1]
            seen.update(item['id'] for item in latest['items'])
            if not latest['has_more']:
                return ModelResponse([answer_part('已读完所有比赛。')])
        return ModelResponse([ToolCallPart('search_contests', {'page': len(results) + 1, 'page_size': 5})])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory))
    assert events[-1].type == 'answer' and seen == expected
    assert sum(event.type == 'observation' for event in events) == 3


def test_web_tool_uses_the_requested_provider_count(session_factory):
    calls = 0
    requested = []
    returned = []
    async def search(query, *, site=None, count=10):
        requested.append(count)
        return [{'title': f'结果{i}', 'url': f'https://organizer.example/{i}', 'site': '主办方'} for i in range(count)]
    def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('web_search', {'query': '黑客松', 'count': 25})])
        latest = next(part for message in reversed(messages) for part in message.parts if isinstance(part, ToolReturnPart))
        returned.extend(latest.content['items'])
        return ModelResponse([answer_part('已查看搜索结果。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, search=search))
    assert events[-1].type == 'answer' and requested == [25]
    assert len(returned) == 25


def test_page_tool_can_read_a_requested_range_without_losing_the_tail(session_factory):
    body = '公开介绍。' * 1600 + '报名截止：10月25日。'
    calls = 0
    observed = []
    def respond(messages, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules',
                                                             'offset': 8000, 'length': 100})])
        latest = next(part for message in reversed(messages) for part in message.parts if isinstance(part, ToolReturnPart))
        observed.append(latest.content)
        return ModelResponse([answer_part('报名截止日期已找到。')])
    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, fetch=lambda _: body))
    assert events[-1].type == 'answer', events[-1].payload
    assert observed[0]['text'] == '报名截止：10月25日。'
    assert observed[0]['total_chars'] == len(body)
