"""先移除最旧的完整轮次，再截取超长资料；不拆散工具调用与回执。"""
import json
from dataclasses import replace

from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, ModelResponse, SystemPromptPart, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart

PAGE_BYTES = 16_000
PROFILE_MARKER = '\n用户已确认的画像资料：'


def excerpt(text, limit=PAGE_BYTES):
    data = text.encode()
    if len(data) <= limit:
        return text
    marker = '\n[正文节选]\n'.encode()
    if limit < len(marker) + 8:
        return data[:limit].decode(errors='ignore')
    available = limit - len(marker)
    head = available * 3 // 4
    return data[:head].decode(errors='ignore') + marker.decode() + data[-(available - head):].decode(errors='ignore')


def fit_messages(messages, limit):
    messages = list(messages)
    def size(items):
        return len(ModelMessagesTypeAdapter.dump_json(items))

    while size(messages) > limit:
        starts = [i for i, item in enumerate(messages) if isinstance(item, ModelRequest)
                  and any(isinstance(part, UserPromptPart) for part in item.parts)]
        if len(starts) < 2:
            break
        first, second = starts[:2]
        system = [part for item in messages[first:second] if isinstance(item, ModelRequest)
                  for part in item.parts if isinstance(part, SystemPromptPart)]
        messages[first:second] = [replace(messages[first], parts=system)] if system else []
    while size(messages) > limit:
        pair = next((i for i in range(len(messages) - 2)
                     if isinstance(messages[i], ModelResponse)
                     and any(isinstance(part, ToolCallPart) for part in messages[i].parts)
                     and isinstance(messages[i + 1], ModelRequest)
                     and all(isinstance(part, ToolReturnPart) for part in messages[i + 1].parts)), None)
        if pair is None:
            break
        del messages[pair:pair + 2]
    if size(messages) <= limit:
        return messages

    def clipped(cap):
        result = []
        for item in messages:
            parts = []
            for part in item.parts:
                if isinstance(part, ToolReturnPart):
                    text = json.dumps(part.content, ensure_ascii=False, default=str)
                    parts.append(replace(part, content=excerpt(text, cap)) if len(text.encode()) > cap else part)
                elif isinstance(part, (UserPromptPart, TextPart)) and isinstance(part.content, str):
                    parts.append(replace(part, content=excerpt(part.content, cap)))
                else:
                    parts.append(part)
            instructions = item.instructions if isinstance(item, ModelRequest) else None
            if instructions and PROFILE_MARKER in instructions:
                rules, profile = instructions.split(PROFILE_MARKER, 1)
                instructions = rules + PROFILE_MARKER + excerpt(profile, cap)
            result.append(replace(item, parts=parts, **({'instructions': instructions} if isinstance(item, ModelRequest) else {})))
        return result

    low, high = 0, max(limit, 0)
    fitted = clipped(0)
    if size(fitted) > limit:
        raise ValueError('固定规则和工具定义超过模型上下文配置')
    while low <= high:
        cap = (low + high) // 2
        candidate = clipped(cap)
        if size(candidate) <= limit:
            fitted, low = candidate, cap + 1
        else:
            high = cap - 1
    return fitted
