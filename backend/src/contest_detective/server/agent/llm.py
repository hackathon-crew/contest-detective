"""所有模型请求（包括网页抽取）通过费用包装；步骤流式不开放模型字节流。"""
import json
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from decimal import Decimal

from openai import AsyncOpenAI
from pydantic_ai.messages import ModelMessagesTypeAdapter
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.profiles.openai import OpenAIModelProfile

from contest_detective.common.exceptions import BizException
from contest_detective.framework.db import SessionLocal

from .budget import Budget, read_balance
from .config import LLMSettings, get_llm_settings


class GuardedModel(WrapperModel):
    def __init__(self, wrapped: Model, budget: Budget, *,
                 balance_reader: Callable[[], Awaitable[Decimal]] | None = None):
        super().__init__(wrapped)
        self.budget = budget
        self.balance_reader = balance_reader or (lambda: read_balance(budget.settings))

    async def request(self, messages, model_settings, model_request_parameters):
        self.budget.ensure_enabled()
        config = self.budget.settings
        # A text-only token needs at least one UTF-8 byte. Include tool schemas and a
        # conservative framing allowance; reject oversized context before any provider call.
        size = len(ModelMessagesTypeAdapter.dump_json(messages))
        size += len(json.dumps(model_request_parameters.declared_tool_defs, default=str, ensure_ascii=False).encode())
        if size + 4096 > config.max_input_tokens:
            raise BizException('查证上下文过长，请缩小问题范围', code=400)
        call_id = self.budget.reserve()
        if config.limits_mode == 'local':
            try:
                balance = await self.balance_reader()
                if not balance.is_finite() or balance < config.balance_floor_cny:
                    raise ValueError('余额不足')
            except Exception as exc:
                self.budget.cancel_before_request(call_id)
                raise BizException('模型余额不足或暂时无法确认余额', code=503) from exc
        # No retry here: once dispatched, failures retain the maximum liability.
        # Body overlays can replace messages or token caps; SDK retry overrides can
        # dispatch another paid request against the same reservation. Accept only
        # generation controls that cannot bypass the input/output spending bound.
        allowed = {'parallel_tool_calls', 'temperature', 'top_p', 'seed', 'stop_sequences'}
        settings = {key: value for key, value in (model_settings or {}).items() if key in allowed}
        settings.update(max_tokens=config.max_tokens, max_retries=0, timeout=30)
        if config.deepseek_options:
            settings['extra_body'] = {'thinking': {'type': 'disabled'}}
        response = await self.wrapped.request(messages, settings, model_request_parameters)
        self.budget.settle(call_id, response.usage)
        return response

    @asynccontextmanager
    async def request_stream(self, *args, **kwargs):
        raise RuntimeError('请使用节点流，模型请求必须经过费用结算')
        yield  # pragma: no cover


def create_model(settings: LLMSettings | None = None, *, session_factory=SessionLocal) -> GuardedModel:
    config = settings or get_llm_settings()
    budget = Budget(session_factory, config)
    budget.ensure_enabled()
    if not config.api_key.get_secret_value():
        raise BizException('侦探模型尚未配置', code=503)
    client = AsyncOpenAI(api_key=config.api_key.get_secret_value(), base_url=config.base_url,
                         max_retries=0, timeout=30)
    model = OpenAIChatModel(config.model, provider=OpenAIProvider(openai_client=client),
        profile=OpenAIModelProfile(openai_chat_supports_max_completion_tokens=False))
    return GuardedModel(model, budget)
