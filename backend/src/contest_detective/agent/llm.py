"""所有模型请求（包括网页抽取）通过费用包装；步骤流式不开放模型字节流。"""
import json
import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
from openai import AsyncOpenAI
from pydantic_ai.messages import ModelMessagesTypeAdapter
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.profiles.openai import OpenAIModelProfile

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import SessionLocal

from .budget import Budget, read_balance, SERVICE_UNAVAILABLE
from .config import LLMSettings, get_llm_settings

logger = logging.getLogger(__name__)


class GuardedModel(WrapperModel):
    def __init__(self, wrapped: Model, budget: Budget, *,
                 balance_reader: Callable[[], Awaitable[Decimal]] | None = None,
                 owned_client: AsyncOpenAI | None = None):
        super().__init__(wrapped)
        self.budget = budget
        self._owned_client = owned_client
        self.balance_reader = balance_reader or (lambda: read_balance(budget.settings))

    async def aclose(self):
        if self._owned_client is not None:
            await self._owned_client.close()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            return await super().__aexit__(exc_type, exc_val, exc_tb)
        finally:
            await self.aclose()

    async def request(self, messages, model_settings, model_request_parameters):
        self.budget.ensure_enabled()
        config = self.budget.settings
        # 本地金额预留需要保守的输入上界；外部模式由网关和模型限制真实上下文容量。
        if config.limits_mode == 'local':
            size = len(ModelMessagesTypeAdapter.dump_json(messages))
            size += len(json.dumps(model_request_parameters.declared_tool_defs, default=str, ensure_ascii=False).encode())
            if size + 4096 > config.max_input_tokens:
                raise BizException('这次的对话或参赛资料太长了，请减少附带资料，或新开对话问一项具体规则。', code=400)
        call_id = self.budget.reserve()
        if config.limits_mode == 'local':
            try:
                balance = await self.balance_reader()
            except httpx.HTTPError as exc:
                self.budget.cancel_before_request(call_id)
                logger.warning('Unable to read model service balance', exc_info=True)
                raise BizException('暂时无法确认查证服务的余额，这次没能完成查证。', code=503) from exc
            except Exception:
                self.budget.cancel_before_request(call_id)
                raise
            if not balance.is_finite():
                self.budget.cancel_before_request(call_id)
                raise BizException('暂时无法确认查证服务的余额，这次没能完成查证。', code=503)
            if balance < config.balance_floor_cny:
                self.budget.cancel_before_request(call_id)
                raise BizException('公共查证服务的余额不足。你可以到账户设置中填写自己的模型密钥后继续。', code=503)
        # Once dispatched, failed requests keep their unconfirmed reservation.
        # Body overlays and SDK retries can bypass local spending reservations.
        # External quotas leave output capacity to the provider as well as input.
        allowed = {'parallel_tool_calls', 'temperature', 'top_p', 'seed', 'stop_sequences'}
        settings = {key: value for key, value in (model_settings or {}).items() if key in allowed}
        settings.update(max_retries=0, timeout=120)
        if config.limits_mode == 'local':
            settings['max_tokens'] = config.max_tokens
        if config.deepseek_options:
            settings['extra_body'] = {'thinking': {'type': 'disabled'}}
        response = await self.wrapped.request(messages, settings, model_request_parameters)
        try:
            self.budget.settle(call_id, response.usage)
        except Exception:
            logger.exception('Usage settlement pending for %s', call_id)
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
        raise BizException(SERVICE_UNAVAILABLE, code=503)
    client = AsyncOpenAI(api_key=config.api_key.get_secret_value(), base_url=config.base_url,
                         max_retries=0, timeout=120)
    model = OpenAIChatModel(config.model, provider=OpenAIProvider(openai_client=client),
        profile=OpenAIModelProfile(openai_chat_supports_max_completion_tokens=False))
    return GuardedModel(model, budget, owned_client=client)
