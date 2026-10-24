"""用 LangChain 将一条结构化来源候选归一化为项目字段。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from decimal import Decimal
from typing import Protocol, cast, runtime_checkable

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from contest_detective.framework.db import SessionLocal
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.research_pipeline.normalization import (
    NormalizationInput,
    merge_normalized,
)

from .budget import Budget
from .config import LLMSettings
from .normalization_governance import LangChainBudgetGovernance
from .normalization_models import NormalizedContest
from .normalization_parser import parse_normalized, usage_from_response
from .normalization_prompts import build_messages


@runtime_checkable
class Normalizer(Protocol):
    async def __call__(self, item: NormalizationInput) -> ContestDraft: ...


class LangChainNormalizer:
    """单场赛事的 LangChain 适配器；业务合并仍由 research pipeline 完成。"""

    def __init__(
        self,
        model: BaseChatModel | None = None,
        *,
        chain=None,
        invoke: Callable[[object], Awaitable[object]] | None = None,
        budget: Budget | None = None,
        balance_reader: Callable[[], Awaitable[Decimal]] | None = None,
        prompt_path: str | None = None,
    ):
        if chain is None and model is None and invoke is None:
            raise ValueError('model、chain 和 invoke 至少提供一个')
        if invoke is not None:
            self._chain = None
        elif chain is not None:
            self._chain = chain
        else:
            active_model = cast(BaseChatModel, model)
            self._chain = active_model.with_structured_output(
                NormalizedContest,
                method='json_mode',
                include_raw=True,
            )
        self._invoke = invoke
        self._governance = (
            LangChainBudgetGovernance(
                budget,
                balance_reader=balance_reader,
            )
            if budget is not None
            else None
        )
        self._prompt_path = prompt_path

    async def __call__(self, item: NormalizationInput) -> ContestDraft:
        async def call():
            if self._invoke is not None:
                return await self._invoke(item)
            return await self._chain.ainvoke(
                build_messages(item, prompt_path=self._prompt_path),
            )

        if self._governance is not None:
            raw = await self._governance.run(
                call,
                usage_from_response,
            )
        else:
            raw = await call()
        parsed = parse_normalized(raw)
        return merge_normalized(item, parsed.output)


def create_normalizer(
    settings: LLMSettings,
    *,
    model: BaseChatModel | None = None,
    budget: Budget | None = None,
    session_factory=SessionLocal,
    balance_reader: Callable[[], Awaitable[Decimal]] | None = None,
    prompt_path: str | None = None,
):
    if not settings.enabled or not settings.api_key.get_secret_value():
        return None
    active_budget = budget or Budget(session_factory, settings)
    if model is None:
        model = ChatOpenAI(
            model=settings.model,
            api_key=settings.api_key.get_secret_value(),
            base_url=settings.base_url,
            temperature=0,
            max_retries=0,
            timeout=120,
            max_tokens=settings.max_tokens if settings.limits_mode == 'local' else None,
        )
    return LangChainNormalizer(
        model=model,
        budget=active_budget,
        balance_reader=balance_reader,
        prompt_path=prompt_path or settings.normalization_prompt_path,
    )


__all__ = [
    'LangChainNormalizer',
    'Normalizer',
    'NormalizedContest',
    'create_normalizer',
]
