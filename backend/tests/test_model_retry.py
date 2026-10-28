import asyncio
from decimal import Decimal

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from sqlalchemy import select

from contest_detective.agent import llm
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.models import LLMUsage


@pytest.mark.parametrize('failure', [500, 503, 429, 'timeout', 'connection'])
def test_transient_model_attempts_have_individual_reservations_and_final_settlement(session_factory, monkeypatch, failure):
    attempts = []
    real_client = llm.AsyncOpenAI
    def handle(request):
        attempts.append(request)
        if len(attempts) <= 2:
            if failure == 'timeout':
                raise httpx.ReadTimeout('temporary', request=request)
            if failure == 'connection':
                raise httpx.ConnectError('temporary', request=request)
            return httpx.Response(failure, json={'error': {'message': 'temporary', 'type': 'server_error'}})
        return httpx.Response(200, json={
            'id': 'test', 'object': 'chat.completion', 'created': 1, 'model': 'test',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '正常回答'}}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120},
        })
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            model = llm.create_model(LLMSettings(_env_file=None, enabled=True, api_key='test', limits_mode='external'), session_factory=session_factory)
            async with model:
                return await Agent(model).run('查询比赛')
    assert asyncio.run(exercise()).output == '正常回答'
    assert len(attempts) == 3
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage).order_by(LLMUsage.created_at)).all()
        assert len(rows) == len(attempts)
        assert [row.status for row in rows] == ['reserved', 'reserved', 'settled']
        assert rows[-1].cost_cny == Decimal('0.00036')
        assert all(row.cost_cny == row.reserved_cny > 0 for row in rows[:2])


@pytest.mark.parametrize('status,code', [(401, 'invalid_api_key'), (403, 'permission_denied'), (402, 'insufficient_balance'), (429, 'insufficient_quota')])
def test_key_and_billing_errors_do_not_retry(session_factory, monkeypatch, status, code):
    calls = []
    real_client = llm.AsyncOpenAI
    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message': code, 'code': code, 'type': code}})
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            model = llm.create_model(LLMSettings(_env_file=None, enabled=True, api_key='test', limits_mode='external'), session_factory=session_factory)
            async with model:
                with pytest.raises(ModelHTTPError):
                    await Agent(model).run('查询比赛')
    asyncio.run(exercise())
    assert len(calls) == 1
