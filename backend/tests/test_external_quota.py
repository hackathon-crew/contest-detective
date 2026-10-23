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
