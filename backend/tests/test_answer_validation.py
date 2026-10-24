import asyncio
import json
from decimal import Decimal

import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
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
from contest_detective.web.api.agent import get_investigator, limiter

URL = 'https://organizer.example/output-rules'
CITED = f'作品提交截止为[2026-10-27 16:00]({URL})，报名截止未找到。'


def seed(session_factory, *, day=False):
    with session_factory() as session:
        return service.save(session, ContestDraft(name='出处回归赛事', page={
            'url': URL, 'site': '主办方', 'title': '公开规则', 'is_official': True,
        }, claims=[{'field': 'submission_deadline', 'value': '2026-10-27' if day else '2026-10-27T08:00:00Z',
                    'precision': 'day' if day else 'datetime', 'excerpt': '10月27日提交截止'}]))


def run(session_factory, respond):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only', limits_mode='external')
    model = GuardedModel(FunctionModel(respond), Budget(session_factory, settings))
    async def consume():
        return [event async for event in Investigator(model, session_factory=session_factory).ask('何时提交，16:00是否报名截止？')]
    return asyncio.run(consume())


def response(parts):
    return ModelResponse(parts, usage=RequestUsage(input_tokens=100, output_tokens=20))


@pytest.mark.parametrize('answer,day', [
    ('按北京时间2026-10-24计算，明天是10月25日。\n' + CITED, False),
    (f'作品提交截止是2026-10-27 16:00，报名截止仍未核实。\n原文：{URL}', False),
    (f'作品提交截止为10月27日；16:00是否为报名截止，目前无法确认。\n[原文]({URL})', True),
    ('报名截止未核实，[报名页](https://organizer.example/registration)尚未读取。', False),
])
def test_partial_answers_complete_without_format_corrections(session_factory, answer, day):
    contest_id = seed(session_factory, day=day)
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response([ToolCallPart('get_contest', {'contest_id': contest_id})]
                        if calls == 1 else [TextPart(answer)])

    events = run(session_factory, respond)

    assert [event.type for event in events] == ['step', 'observation', 'answer']
    assert events[-1].payload['content'] == answer
    assert [source['url'] for source in events[-1].payload['sources']] == [URL]
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.answer == answer
        traces = session.scalars(select(TraceRecord).order_by(TraceRecord.seq)).all()
        assert [trace.type for trace in traces] == ['step', 'observation', 'answer']
        assert traces[-1].payload['content'] == answer
        usage = session.scalars(select(LLMUsage)).all()
        assert len(usage) == 2 and all(row.status == 'settled' for row in usage)
        assert sum(row.cost_cny for row in usage) == Decimal('0.00072')


def test_final_answer_on_last_request_completes_without_a_format_retry(session_factory):
    calls = 0
    answer = '10月25日是否截止报名尚未核实。'
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response([ToolCallPart('search_contests', {}, tool_call_id=f'call-{calls}')]
                        if calls <= 63 else [TextPart(answer)])

    events = run(session_factory, respond)

    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert sum(event.type == 'observation' for event in events) == 63
    with session_factory() as session:
        record = session.scalars(select(Investigation)).one()
        assert record.status == 'completed' and record.answer == answer
        usage = session.scalars(select(LLMUsage)).all()
        assert len(usage) == 64 and all(row.status == 'settled' for row in usage)


def test_partial_answer_reaches_the_http_event_stream(client, session_factory):
    contest_id = seed(session_factory)
    answer = f'已查到作品提交截止是2026-10-27 16:00，报名截止仍未核实。\n来源：{URL}'
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        if calls == 1:
            return response([ToolCallPart('search_contests', {'keyword': '出处回归'})])
        if calls == 2:
            return response([ToolCallPart('get_contest', {'contest_id': contest_id})])
        return response([TextPart(answer)])

    client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory)
    limiter.reset()
    try:
        result = client.post('/agent/ask', json={'question': '帮我找一下明天截止报名的黑客松。'})
        assert result.status_code == 200
        assert result.headers['content-type'].startswith('text/event-stream')
        assert [line for line in result.text.splitlines() if line.startswith('event: ')] == [
            'event: step', 'event: observation', 'event: step', 'event: observation', 'event: answer',
        ]
        payloads = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith('data: ')]
        assert payloads[-1]['content'] == answer
        assert [source['url'] for source in payloads[-1]['sources']] == [URL]
        with session_factory() as session:
            record = session.scalars(select(Investigation)).one()
            assert record.status == 'completed' and record.answer == answer
    finally:
        client.app.dependency_overrides.pop(get_investigator)
        limiter.reset()
