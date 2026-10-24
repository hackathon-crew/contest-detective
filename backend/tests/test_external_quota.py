import asyncio
from decimal import Decimal

import pytest
from pydantic import ValidationError
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage
from sqlalchemy import select

from contest_detective.common.exceptions import BizException
from contest_detective.server.agent.budget import Budget
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.agent.llm import GuardedModel
from contest_detective.server.agent.models import LLMUsage


def config(**overrides):
    return LLMSettings(_env_file=None, enabled=True, api_key='test-only', limits_mode='external', **overrides)


async def no_balance_endpoint():
    raise AssertionError('External quotas must not call a local balance endpoint')


def test_external_quotas_keep_usage_without_local_amount_or_balance_limits(session_factory):
    budget = Budget(session_factory, config(budget_cny='0.000001'))
    response = ModelResponse([TextPart('已读取资料。')], usage=RequestUsage(input_tokens=1000, output_tokens=100))
    model = GuardedModel(FunctionModel(lambda *_: response), budget, balance_reader=no_balance_endpoint)
    for _ in range(2):
        assert asyncio.run(Agent(model).run('查询')).output == '已读取资料。'
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage)).all()
        assert len(rows) == 2
        assert all(row.status == 'settled' for row in rows)
        assert sum(row.cost_cny for row in rows) == Decimal('0.0056')


def test_external_request_errors_keep_the_unconfirmed_reservation(session_factory):
    def fail(*_):
        raise RuntimeError('provider unavailable')
    budget = Budget(session_factory, config(budget_cny='0.000001'))
    model = GuardedModel(FunctionModel(fail), budget, balance_reader=no_balance_endpoint)
    with pytest.raises(RuntimeError, match='provider unavailable'):
        asyncio.run(Agent(model).run('查询'))
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'reserved' and row.cost_cny == row.reserved_cny > 0


def test_external_context_uses_provider_capacity_and_still_records_usage(session_factory):
    question = '赛事原文：在校大学生可参加。' * 3000
    def respond(messages, info):
        assert messages[0].parts[0].content == question
        return ModelResponse([TextPart('已核对赛事出处。')],
                             usage=RequestUsage(input_tokens=24000, output_tokens=500))
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, config(max_input_tokens=8192)),
                         balance_reader=no_balance_endpoint)
    assert asyncio.run(Agent(model).run(question)).output == '已核对赛事出处。'
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'settled' and row.cache_miss_tokens == 24000 and row.output_tokens == 500


def test_external_wire_request_leaves_output_capacity_to_the_provider(session_factory, monkeypatch):
    import json
    import httpx
    from contest_detective.server.agent import llm
    real_client, sent = llm.AsyncOpenAI, []
    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={
            'id': 'chatcmpl-external', 'object': 'chat.completion', 'created': 1, 'model': 'deepseek-flash',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '资料已完整整理。'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 6000, 'total_tokens': 6100},
        })
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            model = llm.create_model(config(max_tokens=4096), session_factory=session_factory)
            model.balance_reader = no_balance_endpoint
            return await Agent(model, model_settings={'max_tokens': 8192}).run('整理完整的参赛信息')
    assert asyncio.run(exercise()).output == '资料已完整整理。'
    assert 'max_tokens' not in sent[0] and 'max_completion_tokens' not in sent[0]
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'settled' and row.output_tokens == 6000


def test_external_quotas_do_not_apply_a_local_reservation_ceiling(session_factory):
    budget = Budget(session_factory, config())
    first = budget.reserve()
    budget.settle(first, RequestUsage(input_tokens=1_000_000, output_tokens=1))
    second = budget.reserve()
    with session_factory() as session:
        row = session.get(LLMUsage, first)
        assert row.status == 'settled' and row.cost_cny == Decimal('2.000008')
        assert session.get(LLMUsage, second).status == 'reserved'


def test_local_protection_remains_the_default_and_model_disable_still_applies(session_factory):
    defaults = LLMSettings(_env_file=None)
    assert getattr(defaults, 'limits_mode', None) == 'local'
    with pytest.raises(ValidationError):
        LLMSettings(_env_file=None, limits_mode='unknown')
    disabled = LLMSettings(_env_file=None, limits_mode='external', enabled=False)
    with pytest.raises(BizException, match='尚未启用'):
        Budget(session_factory, disabled).reserve()
