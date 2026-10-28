"""保护的是可花费金额，不把未知用量当成零。"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import init_db
from contest_detective.agent.budget import Budget, calculate_cost, read_balance
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.llm import GuardedModel, create_model
from contest_detective.agent.models import LLMUsage


def settings(**kwargs):
    return LLMSettings(_env_file=None, enabled=True, api_key='test-only', **kwargs)


def usage(hit=1000, miss=2000, output=500):
    return RequestUsage(input_tokens=hit + miss, cache_read_tokens=hit, output_tokens=output)


def test_high_peak_prices_keep_decimal_precision():
    assert calculate_cost(usage()) == Decimal('0.00804')
    # The compatible API exposes its cache split as extra integer details.
    raw = RequestUsage(input_tokens=3000, output_tokens=500, details={
        'prompt_cache_hit_tokens': 1000, 'prompt_cache_miss_tokens': 2000,
    })
    assert calculate_cost(raw) == Decimal('0.00804')


@pytest.mark.parametrize('bad', [
    RequestUsage(unmeasured_requests=1),
    RequestUsage(),
    RequestUsage(input_tokens=-1, output_tokens=1),
    RequestUsage(input_tokens=10, cache_read_tokens=11, output_tokens=1),
    RequestUsage(input_tokens=10, output_tokens=1, details={
        'prompt_cache_hit_tokens': 1, 'prompt_cache_miss_tokens': 1,
    }),
])
def test_missing_or_invalid_usage_is_not_free(bad):
    with pytest.raises(ValueError):
        calculate_cost(bad)


def test_disabled_switch_prevents_balance_and_model_access(session_factory):
    config = LLMSettings(_env_file=None, enabled=False, api_key='test-only')
    with pytest.raises(BizException, match='尚未启用'):
        create_model(config, session_factory=session_factory)
    budget = Budget(session_factory, config)
    with pytest.raises(BizException, match='尚未启用'):
        budget.reserve()
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).all() == []


def test_quota_checks_include_maximum_next_request(session_factory):
    budget = Budget(session_factory, settings(budget_cny='0.01'))
    with pytest.raises(BizException, match='模型额度已用完'):
        budget.reserve()
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).all() == []


def test_settlement_is_idempotent_and_releases_unused_reservation(session_factory):
    budget = Budget(session_factory, settings())
    call = budget.reserve()
    budget.settle(call, usage())
    budget.settle(call, usage())
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage)).all()
        assert len(rows) == 1
        assert rows[0].status == 'settled'
        assert rows[0].cost_cny == Decimal('0.00804')
        assert (rows[0].cache_hit_tokens, rows[0].cache_miss_tokens, rows[0].output_tokens) == (1000, 2000, 500)
    # Repeat settlement with different data must not rewrite the ledger.
    with pytest.raises(ValueError, match='结算'):
        budget.settle(call, usage(output=1000))


def test_two_concurrent_calls_cannot_reserve_the_same_money(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path}/ledger.db', connect_args={'check_same_thread': False})
    init_db(engine)
    factory = sessionmaker(bind=engine)
    budget = Budget(factory, settings(budget_cny='0.2'))
    barrier = Barrier(2)
    def reserve():
        barrier.wait()
        try:
            return budget.reserve()
        except BizException:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(item is not None for item in result) == 1
    engine.dispose()


@pytest.mark.parametrize('balance', ['89.99', 'broken'])
def test_low_or_unreadable_balance_releases_unspent_reservation(session_factory, balance):
    async def balance_reader():
        if balance == 'broken':
            raise httpx.ConnectError('offline')
        return Decimal(balance)
    model = GuardedModel(FunctionModel(lambda *_: pytest.fail('model request must be blocked')),
                         Budget(session_factory, settings()), balance_reader=balance_reader)
    with pytest.raises(httpx.ConnectError if balance == 'broken' else BizException):
        asyncio.run(Agent(model).run('查询'))
    with session_factory() as session:
        assert sum(row.cost_cny for row in session.scalars(select(LLMUsage))) == 0


def test_provider_error_keeps_the_reserved_liability(session_factory):
    async def enough():
        return Decimal('100')
    def fail(*_):
        raise RuntimeError('provider failed')
    budget = Budget(session_factory, settings())
    model = GuardedModel(FunctionModel(fail), budget, balance_reader=enough)
    with pytest.raises(RuntimeError, match='provider failed'):
        asyncio.run(Agent(model).run('查询'))
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'reserved'
        assert row.cost_cny == row.reserved_cny > 0


def test_missing_usage_keeps_reservation_and_delivers_the_answer(session_factory):
    async def enough():
        return Decimal('100')
    model = GuardedModel(FunctionModel(lambda *_: ModelResponse([TextPart('ok')], usage=RequestUsage(unmeasured_requests=1))),
                         Budget(session_factory, settings()), balance_reader=enough)
    assert asyncio.run(Agent(model).run('查询')).output == 'ok'
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'reserved' and row.cost_cny > 0


def test_successful_model_request_settles_real_reported_usage(session_factory):
    async def enough():
        return Decimal('100')
    def respond(_, info):
        assert 2000 <= info.model_settings['max_tokens'] <= 8192
        return ModelResponse([TextPart('查不到')], usage=usage())
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, settings()), balance_reader=enough)
    result = asyncio.run(Agent(model).run('查询'))
    assert result.output == '查不到'
    assert result.usage.input_tokens == 3000
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).one().cost_cny == Decimal('0.00804')


def test_balance_reader_uses_documented_endpoint_without_real_network():
    def handle(request):
        assert request.url.path == '/user/balance'
        return httpx.Response(200, json={'is_available': True, 'balance_infos': [
            {'currency': 'CNY', 'total_balance': '99.64', 'granted_balance': '0', 'topped_up_balance': '99.64'}
        ]})
    async def check():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            return await read_balance(settings(), client=client)
    assert asyncio.run(check()) == Decimal('99.64')


def test_disabled_request_never_reads_balance_or_dispatches_model(session_factory):
    async def forbidden_balance():
        pytest.fail('disabled configuration reached balance endpoint')
    model = GuardedModel(FunctionModel(lambda *_: pytest.fail('disabled configuration reached provider')),
                         Budget(session_factory, LLMSettings(_env_file=None, enabled=False)),
                         balance_reader=forbidden_balance)
    with pytest.raises(BizException, match='尚未启用'):
        asyncio.run(Agent(model).run('查询'))


def test_overlarge_context_is_trimmed_before_dispatch(session_factory):
    from pydantic_ai.messages import ModelMessagesTypeAdapter
    async def enough():
        return Decimal('100')
    def respond(messages, _):
        assert len(ModelMessagesTypeAdapter.dump_json(messages)) + 4096 <= 8192
        return ModelResponse([TextPart('继续查证')], usage=usage())
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, settings(max_input_tokens=8192)), balance_reader=enough)
    assert asyncio.run(Agent(model).run('问题' * 5000)).output == '继续查证'


def test_unexpected_provider_overrun_blocks_all_later_requests(session_factory):
    budget = Budget(session_factory, settings())
    call = budget.reserve()
    with pytest.raises(ValueError, match='超出预留'):
        budget.settle(call, usage(hit=0, miss=100_000, output=1_000))
    with pytest.raises(BizException, match='模型额度已用完'):
        budget.reserve()


def test_confirmed_profile_context_is_trimmed_in_actual_request_instructions(session_factory):
    async def enough():
        return Decimal(100)
    def respond(_, info):
        assert len(info.instructions.encode()) < 4096
        assert '规则' in info.instructions
        return ModelResponse([TextPart('继续查证')], usage=usage())
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, settings(max_input_tokens=8192)), balance_reader=enough)
    result = asyncio.run(Agent(model, instructions='规则\n用户已确认的画像资料：' + '已确认资料' * 5000).run('查询'))
    assert result.output == '继续查证'


def test_overrun_cannot_be_downgraded_by_replayed_smaller_usage(session_factory):
    budget = Budget(session_factory, settings())
    call = budget.reserve()
    with pytest.raises(ValueError, match='超出预留'):
        budget.settle(call, usage(hit=0, miss=100_000, output=1_000))
    with pytest.raises(ValueError, match='结算'):
        budget.settle(call, usage())
    with session_factory() as session:
        row = session.get(LLMUsage, call)
        assert row.status == 'overrun'
        assert row.cost_cny == Decimal('0.208')
        assert (row.cache_hit_tokens, row.cache_miss_tokens, row.output_tokens) == (0, 100_000, 1_000)
    with pytest.raises(BizException, match='模型额度已用完'):
        budget.reserve()


@pytest.mark.parametrize('overrides', [{}, {'extra_body': {
    'max_tokens': 60000, 'max_completion_tokens': 60000,
    'messages': [{'role': 'user', 'content': 'bypass'}],
}}])
def test_deepseek_wire_request_preserves_the_reserved_output_cap(session_factory, monkeypatch, overrides):
    import json
    from contest_detective.agent import llm
    real_client = llm.AsyncOpenAI
    def handle(request):
        payload = json.loads(request.content)
        assert payload['max_tokens'] == 8192
        assert request.extensions['timeout']['read'] == 120
        assert 'max_completion_tokens' not in payload
        assert payload['thinking'] == {'type': 'disabled'}
        assert payload['messages'][0]['content'] == '查询'
        return httpx.Response(200, json={
            'id': 'chatcmpl-local', 'object': 'chat.completion', 'created': 1, 'model': 'deepseek-flash',
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': '查不到'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 3000, 'completion_tokens': 500, 'total_tokens': 3500,
                      'prompt_cache_hit_tokens': 1000, 'prompt_cache_miss_tokens': 2000},
        })
    async def enough():
        return Decimal('100')
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            model = llm.create_model(settings(), session_factory=session_factory)
            model.balance_reader = enough
            return await Agent(model, model_settings=overrides).run('查询')
    assert asyncio.run(exercise()).output == '查不到'
    with session_factory() as session:
        assert session.scalars(select(LLMUsage)).one().cost_cny == Decimal('0.00804')


def test_call_settings_cannot_turn_sdk_retries_back_on(session_factory, monkeypatch):
    from pydantic_ai.exceptions import ModelHTTPError
    from contest_detective.agent import llm
    real_client, requests = llm.AsyncOpenAI, []
    def fail(request):
        requests.append(request)
        return httpx.Response(500, json={'error': {'message': 'offline', 'type': 'server_error'}})
    async def enough():
        return Decimal('100')
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(fail)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            model = llm.create_model(settings(), session_factory=session_factory)
            model.balance_reader = enough
            with pytest.raises(ModelHTTPError):
                await Agent(model, model_settings={'max_retries': 1}).run('查询')
    asyncio.run(exercise())
    assert len(requests) == 3
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage)).all()
        assert len(rows) == len(requests) and all(row.status == 'reserved' for row in rows)
