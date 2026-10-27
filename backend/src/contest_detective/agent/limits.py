"""在硬上限前让模型用已经读取的资料完成答复。"""
from dataclasses import dataclass

from pydantic_ai import RunContext, SystemPromptPart, ToolDefinition
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.models import ModelRequestContext

from .tools import ToolDeps


def _remaining(ctx: RunContext[ToolDeps]) -> tuple[int | None, int | None]:
    limits = ctx.usage_limits
    requests = None if limits.request_limit is None else limits.request_limit - ctx.usage.requests
    tools = None if limits.tool_calls_limit is None else limits.tool_calls_limit - ctx.usage.tool_calls
    return requests, tools


@dataclass
class WrapUpNearRequestLimit(AbstractCapability[ToolDeps]):
    warn_at: int = 3

    async def before_model_request(self, ctx: RunContext[ToolDeps], request_context: ModelRequestContext) -> ModelRequestContext:
        requests, tools = _remaining(ctx)
        if any(left is not None and left <= self.warn_at for left in (requests, tools)):
            ctx.deps.wrapping_up = True
            left = '、'.join(text for count, text in (
                (requests, f'{requests} 次模型请求'), (tools, f'{tools} 次工具调用')) if count is not None)
            ctx.enqueue(SystemPromptPart(
                f'本轮还剩 {left}。现在开始收尾，用已经读取的资料写出最终回答。'
                '尚未核实的内容用平常话写进正文，不要求用户等待或重试。', scope='request'))
        return request_context

    async def prepare_tools(self, ctx: RunContext[ToolDeps], tool_defs: list[ToolDefinition]) -> list[ToolDefinition]:
        requests, tools = _remaining(ctx)
        if any(left is not None and left <= 1 for left in (requests, tools)):
            return []
        # 当前请求、网页抽取、最终成文至少需要三次模型请求。
        if requests == 2:
            return [tool for tool in tool_defs if tool.name != 'record_page']
        return tool_defs
