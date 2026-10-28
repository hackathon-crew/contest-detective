import asyncio
from decimal import Decimal

import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from agent_responses import answer_part
from contest_detective.agent.budget import Budget
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.llm import GuardedModel
from contest_detective.agent.loop import Investigator


def collect(investigator):
    async def scenario():
        return [event async for event in investigator.ask('查比赛的报名时间')]
    return asyncio.run(scenario())


def test_public_quota_exhaustion_includes_reason_and_settings_action(session_factory):
    config = LLMSettings(_env_file=None, enabled=True, api_key='test', budget_cny=Decimal('0.01'))
    model = GuardedModel(FunctionModel(lambda *_: pytest.fail('quota must block dispatch')), Budget(session_factory, config))
    events = collect(Investigator(model, session_factory=session_factory))
    assert events[-1].payload['action'] == 'settings'
    assert '公共查证额度' in events[-1].payload['message']


def test_invalid_saved_key_is_not_retried_and_links_to_settings(session_factory):
    requests = []
    def invalid(*_):
        requests.append(1)
        raise ModelHTTPError(401, 'test', {'error': 'invalid_api_key'})
    config = LLMSettings(_env_file=None, enabled=True, api_key='test', limits_mode='external')
    events = collect(Investigator(GuardedModel(FunctionModel(invalid), Budget(session_factory, config)), session_factory=session_factory))
    assert requests == [1]
    assert events[-1].payload['action'] == 'settings'
    assert '重新保存' in events[-1].payload['message']


def test_no_database_or_web_results_offers_official_link_action(session_factory):
    def respond(messages, _):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('search_contests', {'keyword': '没有的比赛'})])
        if len(results) == 1:
            return ModelResponse([ToolCallPart('web_search', {'query': '没有的比赛官网'})])
        return ModelResponse([answer_part('尚未找到比赛资料。')])
    async def search(*_, **__):
        return []
    events = collect(Investigator(FunctionModel(respond), session_factory=session_factory, search=search))
    assert events[-1].payload['action'] == 'provide_link'
    assert '官网链接' in events[-1].payload['content']


def test_unexpected_failure_keeps_read_material_and_offers_retry_with_stack(session_factory, caplog):
    calls = 0
    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])
        raise RuntimeError('private-provider-failure')
    events = collect(Investigator(FunctionModel(respond), session_factory=session_factory,
                                  fetch=lambda _: '原文明确写着：十月三十一日报名截止。'))
    assert events[-1].type == 'answer'
    assert events[-1].payload['action'] == 'retry'
    assert '十月三十一日' in events[-1].payload['content']
    assert 'private-provider' not in str(events[-1].payload)
    assert any(record.exc_info and isinstance(record.exc_info[1], RuntimeError) for record in caplog.records)
