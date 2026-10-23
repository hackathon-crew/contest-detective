"""按高峰价计费。SQLite 写锁把余额占用的检查和预留放在同一事务里。"""
from decimal import Decimal
from uuid import uuid4

import httpx
from pydantic_ai.usage import RequestUsage
from sqlalchemy import func, select, text

from contest_detective.common.exceptions import BizException
from contest_detective.framework.db import SessionLocal

from .config import LLMSettings, get_llm_settings
from .models import LLMUsage

MILLION = Decimal(1_000_000)


def token_split(usage: RequestUsage) -> tuple[int, int, int]:
    hit = usage.details.get('prompt_cache_hit_tokens', usage.cache_read_tokens)
    miss = usage.details.get('prompt_cache_miss_tokens', usage.input_tokens - hit)
    counts = (usage.input_tokens, hit, miss, usage.output_tokens)
    if (usage.unmeasured_requests or any(type(value) is not int or value < 0 for value in counts)
            or hit + miss != usage.input_tokens or usage.input_tokens + usage.output_tokens == 0):
        raise ValueError('模型用量缺失或无效，保留费用预留')
    return hit, miss, usage.output_tokens


def calculate_cost(usage: RequestUsage) -> Decimal:
    hit, miss, output = token_split(usage)
    return (Decimal(hit) * Decimal('0.04') + Decimal(miss) * 2 + Decimal(output) * 8) / MILLION


class Budget:
    def __init__(self, session_factory=SessionLocal, settings: LLMSettings | None = None):
        self.session_factory = session_factory
        self.settings = settings or get_llm_settings()

    def ensure_enabled(self):
        if not self.settings.enabled:
            raise BizException('侦探模型尚未启用', code=503)

    def reserve(self) -> str:
        self.ensure_enabled()
        maximum = (Decimal(self.settings.max_input_tokens) * 2 + Decimal(self.settings.max_tokens) * 8) / MILLION
        with self.session_factory() as session:
            # Deferred SQLite transactions otherwise let two readers approve the same remainder.
            session.execute(text('BEGIN IMMEDIATE'))
            total = session.scalar(select(func.coalesce(func.sum(LLMUsage.cost_cny), 0)))
            if session.scalar(select(LLMUsage.id).where(LLMUsage.status == 'overrun').limit(1)) or total + maximum > self.settings.budget_cny:
                raise BizException('模型额度已用完', code=429)
            call_id = str(uuid4())
            session.add(LLMUsage(id=call_id, model=self.settings.model,
                                 reserved_cny=maximum, cost_cny=maximum, status='reserved'))
            session.commit()
            return call_id

    def cancel_before_request(self, call_id: str):
        """仅在确定还未向模型发请求时撤销；请求异常不走这里。"""
        with self.session_factory() as session:
            session.execute(text('BEGIN IMMEDIATE'))
            row = session.get(LLMUsage, call_id)
            if row is not None and row.status == 'reserved':
                row.status, row.cost_cny = 'cancelled', Decimal(0)
                session.commit()

    def settle(self, call_id: str, usage: RequestUsage):
        cost = calculate_cost(usage)
        hit, miss, output = token_split(usage)
        with self.session_factory() as session:
            session.execute(text('BEGIN IMMEDIATE'))
            row = session.get(LLMUsage, call_id)
            if row is None or row.status == 'cancelled':
                raise ValueError('费用预留不存在，无法结算')
            if row.status in {'settled', 'overrun'}:
                if (row.cache_hit_tokens, row.cache_miss_tokens, row.output_tokens) != (hit, miss, output):
                    raise ValueError('同一请求不能重复结算为不同用量')
                if row.status == 'overrun':
                    raise ValueError('模型返回用量超出预留，停止后续调用')
                return
            row.cache_hit_tokens, row.cache_miss_tokens, row.output_tokens = hit, miss, output
            if cost > row.reserved_cny:
                # Unexpected provider accounting must never turn a reservation into a smaller lie.
                row.cost_cny, row.status = cost, 'overrun'
                session.commit()
                raise ValueError('模型返回用量超出预留，停止后续调用')
            row.cost_cny, row.status = cost, 'settled'
            session.commit()


async def read_balance(settings: LLMSettings, *, client: httpx.AsyncClient | None = None) -> Decimal:
    if not settings.enabled:
        raise BizException('侦探模型尚未启用', code=503)
    if client is None:
        async with httpx.AsyncClient(timeout=10) as owned:
            return await read_balance(settings, client=owned)
    response = await client.get(settings.base_url.rstrip('/') + '/user/balance',
                                headers={'Authorization': 'Bearer ' + settings.api_key.get_secret_value()})
    response.raise_for_status()
    data = response.json()
    if not data.get('is_available'):
        raise ValueError('余额不可用')
    amounts = [Decimal(item['total_balance']) for item in data['balance_infos'] if item['currency'] == 'CNY']
    if not amounts or any(not item.is_finite() or item < 0 for item in amounts):
        raise ValueError('余额不可用')
    return sum(amounts)
