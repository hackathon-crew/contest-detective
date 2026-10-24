"""LangChain 归一化调用的预算和余额治理。"""

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Any

from pydantic_ai.usage import RequestUsage

from .budget import Budget, read_balance


class LangChainBudgetGovernance:
    """把 LangChain 请求接入现有 Budget 账本。"""

    def __init__(
        self,
        budget: Budget,
        *,
        balance_reader: Callable[[], Awaitable[Decimal]] | None = None,
    ):
        self.budget = budget
        self._balance_reader = balance_reader or (
            lambda: read_balance(budget.settings)
        )

    async def run(
        self,
        invoke: Callable[[], Awaitable[Any]],
        settle_usage: Callable[[object], RequestUsage],
    ) -> object:
        self.budget.ensure_enabled()
        call_id = self.budget.reserve()
        if self.budget.settings.limits_mode == 'local':
            try:
                balance = await self._balance_reader()
                if (
                    not balance.is_finite()
                    or balance < self.budget.settings.balance_floor_cny
                ):
                    raise ValueError('余额不足')
            except Exception:
                self.budget.cancel_before_request(call_id)
                raise

        try:
            raw = await invoke()
        except Exception:
            # 请求已经发出，保留 reservation 作为未确认费用。
            raise
        self.budget.settle(call_id, settle_usage(raw))
        return raw


__all__ = ['LangChainBudgetGovernance']
