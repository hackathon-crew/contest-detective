"""解析 LangChain structured-output 响应并转换供应商用量。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TypeGuard

from pydantic_ai.usage import RequestUsage

from .normalization_models import NormalizedContest


@dataclass(frozen=True)
class ParsedNormalization:
    """一次响应的结构化结果和原始响应。"""

    output: NormalizedContest
    raw: object


def parse_normalized(raw: object) -> ParsedNormalization:
    """优先使用 include_raw 返回的 parsed，失败时不信任自由文本。"""
    if _is_raw_payload(raw):
        parsed = raw.get('parsed')
        if parsed is None:
            error = raw.get('parsing_error')
            raise ValueError(
                'LangChain structured output parsing failed',
            ) from error
        return ParsedNormalization(_parse_output(parsed), raw.get('raw'))
    return ParsedNormalization(_parse_output(raw), raw)


def _parse_output(value: object) -> NormalizedContest:
    if isinstance(value, NormalizedContest):
        return value
    payload = _message_payload(value)
    if isinstance(payload, str):
        payload = json.loads(_strip_code_fences(payload))
    return NormalizedContest.model_validate(payload)


def _is_raw_payload(value: object) -> TypeGuard[dict[str, object]]:
    return (
        isinstance(value, dict)
        and 'raw' in value
        and ('parsed' in value or 'parsing_error' in value)
    )


def _message_payload(value: object) -> object:
    content = getattr(value, 'content', value)
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and isinstance(block.get('text'), str):
                parts.append(block['text'])
        return ''.join(parts)
    return content


def _strip_code_fences(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith('```'):
        return stripped
    first_newline = stripped.find('\n')
    body = stripped[first_newline + 1:] if first_newline >= 0 else stripped[3:]
    if body.rstrip().endswith('```'):
        body = body.rstrip()[:-3]
    return body.strip()


def response_message(raw: object) -> object:
    """从 include_raw 包装或直接消息中取出可携带 usage 的响应。"""
    return raw.get('raw') if _is_raw_payload(raw) else raw


def usage_from_response(raw: object) -> RequestUsage:
    """从 LangChain 的两种常见 usage metadata 形状生成账本用量。"""
    message = response_message(raw)
    metadata = getattr(message, 'usage_metadata', None) or {}
    response = getattr(message, 'response_metadata', None) or {}
    token_usage = (
        response.get('token_usage', {})
        if isinstance(response, dict)
        else {}
    )
    if not isinstance(token_usage, dict):
        token_usage = {}

    input_tokens = metadata.get('input_tokens', token_usage.get('prompt_tokens'))
    output_tokens = metadata.get(
        'output_tokens',
        token_usage.get('completion_tokens'),
    )
    if input_tokens is None or output_tokens is None:
        raise ValueError('LangChain response did not include token usage')
    if type(input_tokens) is not int or type(output_tokens) is not int:
        raise ValueError(
            'LangChain response token usage is invalid',
        )
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError(
            'LangChain response token usage is invalid',
        )

    details = metadata.get('input_token_details', {})
    cache_read = details.get('cache_read', 0) if isinstance(details, dict) else 0
    if (
        cache_read == 0
        and isinstance(token_usage.get('prompt_tokens_details'), dict)
    ):
        cache_read = token_usage['prompt_tokens_details'].get('cached_tokens', 0)
    if type(cache_read) is not int or cache_read < 0 or cache_read > input_tokens:
        raise ValueError(
            'LangChain response cache usage is invalid',
        )
    return RequestUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read,
        details={
            'prompt_cache_hit_tokens': cache_read,
            'prompt_cache_miss_tokens': input_tokens - cache_read,
        },
    )


# 兼容旧模块调用方和已有测试的私有函数名称。
def _usage_from_message(message: object) -> RequestUsage:
    return usage_from_response(message)


__all__ = [
    'ParsedNormalization',
    'parse_normalized',
    'response_message',
    'usage_from_response',
]
