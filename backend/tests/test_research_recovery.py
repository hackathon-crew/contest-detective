import asyncio
import json
from decimal import Decimal
from functools import partial

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from agent_responses import answer_part
from contest_detective.agent.budget import Budget
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.llm import GuardedModel
from contest_detective.agent.loop import Investigator
from contest_detective.research.record import run as record_page


def test_search_exhausts_retries_then_model_changes_source_without_public_failure(session_factory):
    queries = []
    async def search(query, **_):
        queries.append(query)
        if query == '第一个比赛来源':
            raise httpx.ReadTimeout('private-provider-error')
        return [{'title': '赛事官网', 'url': 'https://organizer.example/rules', 'site': '主办方'}]
    def respond(messages, _):
        results = [part.content for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('web_search', {'query': '第一个比赛来源'})])
        if len(results) == 1:
            assert results[0]['model_hint'] and results[0]['error']
            return ModelResponse([ToolCallPart('web_search', {'query': '换一个比赛来源'})])
        return ModelResponse([answer_part('已找到赛事官网，继续核对参赛规则。')])
    async def scenario():
        return [event async for event in Investigator(FunctionModel(respond), session_factory=session_factory, search=search).ask('查比赛官网')]
    events = asyncio.run(scenario())
    assert queries == ['第一个比赛来源'] * 3 + ['换一个比赛来源']
    assert events[-1].type == 'answer'
    observations = [event.payload for event in events if event.type == 'observation']
    assert observations[0]['status'] == 'continuing'
    assert all(item.get('status') != 'failure' for item in observations)
    assert not any(word in json.dumps(observations, ensure_ascii=False) for word in ('private-provider-error', 'model_hint', '失败', '未完成'))


def test_eighty_thousand_character_rules_page_is_extracted_and_answered(session_factory):
    text = '比赛公开规则。' * 12000 + '末尾规则：报名截止为2026年10月31日。'
    calls = []
    def respond(messages, info):
        calls.append(messages)
        if info.output_tools and info.output_tools[0].name != 'respond_to_user':
            encoded = ModelMessagesTypeAdapter.dump_json(messages)
            assert len(encoded) < 65536
            assert '报名截止'.encode() in encoded
            return ModelResponse([ToolCallPart(info.output_tools[0].name, {'name': '规则页比赛', 'claims': [
                {'field': 'registration_deadline', 'value': '2026-10-31', 'precision': 'day', 'excerpt': '报名截止为2026年10月31日。'},
            ]})], usage=RequestUsage(input_tokens=100, output_tokens=20))
        if len(calls) == 1:
            return ModelResponse([ToolCallPart('record_page', {'url': 'https://organizer.example/rules'})], usage=RequestUsage(input_tokens=100, output_tokens=20))
        result = next(part.content for message in reversed(messages) for part in message.parts if isinstance(part, ToolReturnPart))
        assert result['contest_id']
        return ModelResponse([answer_part('规则页注明报名截止为10月31日。')], usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def balance():
        return Decimal(100)
    config = LLMSettings(_env_file=None, enabled=True, api_key='test')
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, config), balance_reader=balance)
    async def scenario():
        return [event async for event in Investigator(model, session_factory=session_factory,
            record=partial(record_page, page_text=text)).ask('查规则页的报名截止')]
    events = asyncio.run(scenario())
    assert events[-1].type == 'answer' and '10月31日' in events[-1].payload['content']
    assert len(calls) == 3
    assert not any(event.type == 'error' for event in events)


@pytest.mark.parametrize('limits_mode', ['local', 'external'])
def test_long_history_is_trimmed_before_dispatch_and_latest_question_is_kept(session_factory, limits_mode):
    received = []
    def respond(messages, _):
        received.extend(messages)
        assert len(ModelMessagesTypeAdapter.dump_json(messages)) + 4096 <= 8192
        assert messages[-1].parts[-1].content == '只看线上比赛的报名截止'
        return ModelResponse([TextPart('按线上比赛继续查证。')], usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def balance():
        return Decimal(100)
    model = GuardedModel(FunctionModel(respond), Budget(session_factory,
        LLMSettings(_env_file=None, enabled=True, api_key='test', max_input_tokens=8192, limits_mode=limits_mode)), balance_reader=balance)
    history = [message for i in range(20) for message in (
        ModelRequest([UserPromptPart(f'旧问题{i}：' + '比赛条件' * 1000)]), ModelResponse([TextPart('旧回答' * 1000)]))]
    assert asyncio.run(Agent(model).run('只看线上比赛的报名截止', message_history=history)).output == '按线上比赛继续查证。'
    assert len(received) < len(history)
