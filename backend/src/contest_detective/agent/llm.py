"""所有模型请求（包括网页抽取）通过费用包装；步骤流式不开放模型字节流。"""
import json
import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from decimal import Decimal

from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.messages import InstructionPart, ModelRequest
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.profiles.openai import OpenAIModelProfile
from pydantic_ai.exceptions import ModelHTTPError, ModelQuotaExceededError
from sqlalchemy.exc import SQLAlchemyError

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import SessionLocal

from .budget import Budget, read_balance, SERVICE_UNAVAILABLE, SETTINGS_ACTION
from .config import LLMSettings, get_llm_settings
from .retry import retry_transient
from .context import fit_messages

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
        tools_size = len(json.dumps(model_request_parameters.declared_tool_defs, default=str, ensure_ascii=False).encode())
        messages = fit_messages(messages, self.budget.settings.max_input_tokens - tools_size - 4096)
        if model_request_parameters.instruction_parts is not None:
            instructions = next(item.instructions for item in reversed(messages) if isinstance(item, ModelRequest))
            model_request_parameters = replace(model_request_parameters,
                instruction_parts=[InstructionPart(content=instructions)] if instructions else [])
        try:
            return await retry_transient(lambda: self._request_once(messages, model_settings, model_request_parameters))
        except ModelQuotaExceededError as exc:
            raise BizException('模型账户的可用额度已用完。请到账户设置中保存有可用额度的密钥。', code=429, data=SETTINGS_ACTION) from exc
        except ModelHTTPError as exc:
            if exc.status_code in {401, 403}:
                raise BizException('模型密钥已失效或无权使用。请到账户设置中重新保存密钥。', code=401, data=SETTINGS_ACTION) from exc
            if exc.status_code == 402:
                raise BizException('模型账户的余额不足。请到账户设置中保存有可用余额的密钥。', code=429, data=SETTINGS_ACTION) from exc
            raise

    async def _request_once(self, messages, model_settings, model_request_parameters):
        self.budget.ensure_enabled()
        config = self.budget.settings
        call_id = self.budget.reserve()
        if config.limits_mode == 'local':
            confirmed = False
            try:
                balance = await self.balance_reader()
                if not balance.is_finite():
                    raise ValueError('Model balance is not finite')
                if balance < config.balance_floor_cny:
                    raise BizException('公共查证服务的余额不足。你可以到账户设置中填写自己的模型密钥后继续。', code=429, data=SETTINGS_ACTION)
                confirmed = True
            finally:
                if not confirmed:
                    self.budget.cancel_before_request(call_id)
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
        except (ValueError, SQLAlchemyError):
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
        raise BizException(SERVICE_UNAVAILABLE, code=503, data=SETTINGS_ACTION)
    client = AsyncOpenAI(api_key=config.api_key.get_secret_value(), base_url=config.base_url,
                         max_retries=0, timeout=120)
    model = OpenAIChatModel(config.model, provider=OpenAIProvider(openai_client=client),
        profile=OpenAIModelProfile(openai_chat_supports_max_completion_tokens=False))
    return GuardedModel(model, budget, owned_client=client)
