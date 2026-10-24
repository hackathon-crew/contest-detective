import asyncio
import json
from decimal import Decimal

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage
from sqlalchemy import select

from contest_detective.server.agent.budget import Budget
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.agent.llm import GuardedModel
from contest_detective.server.agent.loop import Investigator
from contest_detective.server.agent.models import Investigation, LLMUsage, TraceRecord
from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ContestDraft

URL = 'https://organizer.example/output-rules'
UNCITED = '作品提交截止是2026-10-27 16:00，首份未通过的回答。'
CITED = f'作品提交截止为[2026-10-27 16:00]({URL})，报名截止未找到。'


def seed(session_factory, *, day=False):
    with session_factory() as session:
        return service.save(session, ContestDraft(name='出处回归赛事', page={
            'url': URL, 'site': '主办方', 'title': '公开规则', 'is_official': True,
        }, claims=[{'field': 'submission_deadline', 'value': '2026-10-27' if day else '2026-10-27T08:00:00Z',
                    'precision': 'day' if day else 'datetime', 'excerpt': '10月27日提交截止'}]))


def run(session_factory, respond, *, max_input_tokens=65536):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only', limits_mode='external',
                           max_input_tokens=max_input_tokens)
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, settings))
    async def consume():
        return [event async for event in Investigator(model, session_factory=session_factory).ask('何时提交，16:00是否报名截止？')]
    return asyncio.run(consume())


def response(parts):
    return ModelResponse(parts, usage=RequestUsage(input_tokens=100, output_tokens=20))


def test_uncited_output_is_corrected_once_and_every_request_is_accounted(session_factory):
    contest_id = seed(session_factory)
    calls, feedback = [], []
    def respond(messages, info):
        assert info.model_settings['max_retries'] == 0
        calls.append(messages)
        if len(calls) == 1:
            return response([ToolCallPart('get_contest', {'contest_id': contest_id})])
        if len(calls) == 2:
            return response([TextPart(UNCITED)])
        feedback.extend(part.content for message in messages for part in message.parts
                        if isinstance(part, UserPromptPart) and isinstance(part.content, str) and '请纠正回答' in part.content)
        return response([TextPart(CITED)])
    events = run(session_factory, respond)
    assert len(calls) == 3
    assert len(feedback) == 1 and 'Markdown' in feedback[0] and '每个' in feedback[0] and '已返回' in feedback[0]
    assert events[-1].type == 'answer' and events[-1].payload['content'] == CITED
    with session_factory() as session:
        usage = session.scalars(select(LLMUsage)).all()
        assert len(usage) == 3 and all(row.status == 'settled' for row in usage)
        assert sum(row.cost_cny for row in usage) == Decimal('0.00108')
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.answer == CITED
        assert UNCITED not in json.dumps([row.payload for row in session.scalars(select(TraceRecord))], ensure_ascii=False)


@pytest.mark.parametrize('bad_answer,day', [
    (UNCITED, False),
    ('[作品提交截止为2026-10-27 16:00](https://invented.example/rules)。', False),
    (f'作品提交截止为[2026-10-27 08:00]({URL})。', True),
])
def test_a_second_invalid_output_stops_without_leaking_it_to_business_records(session_factory, bad_answer, day):
    contest_id = seed(session_factory, day=day)
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        assert info.model_settings['max_retries'] == 0
        return response([ToolCallPart('get_contest', {'contest_id': contest_id})] if calls == 1 else [TextPart(bad_answer)])
    events = run(session_factory, respond)
    assert calls == 3
    assert events[-1].type == 'error' and not any(event.type == 'answer' for event in events)
    assert ('时刻' if day else '出处') in events[-1].payload['message']
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'failed' and record.answer is None
        assert bad_answer not in json.dumps([row.payload for row in session.scalars(select(TraceRecord))], ensure_ascii=False)
        assert len(session.scalars(select(LLMUsage)).all()) == 3


def test_output_correction_cannot_bypass_the_twenty_four_request_limit(session_factory):
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response([ToolCallPart('search_contests', {}, tool_call_id=f'call-{calls}')]
                        if calls <= 23 else [TextPart(UNCITED)])
    events = run(session_factory, respond, max_input_tokens=131072)
    assert calls == 24, events[-1].payload
    assert events[-1].type == 'error' and '次数上限' in events[-1].payload['message']
    with session_factory() as session:
        assert len(session.scalars(select(LLMUsage)).all()) == 24


def test_output_correction_cannot_bypass_the_twenty_four_tool_limit(session_factory):
    contest_id = seed(session_factory)
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return response([ToolCallPart('get_contest', {'contest_id': contest_id})])
        if calls == 2:
            return response([TextPart(UNCITED)])
        return response([ToolCallPart('get_contest', {'contest_id': contest_id}, tool_call_id=f'excess-{i}') for i in range(24)])
    events = run(session_factory, respond)
    assert calls == 3
    assert events[-1].type == 'error' and '次数上限' in events[-1].payload['message']
    assert sum(event.type == 'observation' for event in events) == 1
