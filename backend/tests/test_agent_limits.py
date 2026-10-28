import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, SystemPromptPart, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.loop import Investigator
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft


def run(investigator):
    async def consume():
        return [event async for event in investigator.ask('核对比赛规则')]
    return asyncio.run(consume())


def seed(session_factory):
    with session_factory() as session:
        return service.save(session, ContestDraft(name='预算内赛事', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '比赛规则', 'is_official': True,
        }, claims=[{'field': 'prize', 'value': '一万元', 'excerpt': '奖金一万元'}]))


def test_loop_limits_can_be_loaded_from_configuration(monkeypatch):
    monkeypatch.setenv('DETECTIVE_LLM_REQUEST_LIMIT', '37')
    monkeypatch.setenv('DETECTIVE_LLM_TOOL_CALLS_LIMIT', '53')
    settings = LLMSettings(_env_file=None)
    assert (settings.request_limit, settings.tool_calls_limit) == (37, 53)


@pytest.mark.parametrize('structured', [False, True])
@pytest.mark.parametrize(('request_limit', 'tool_calls_limit'), [(3, 20), (20, 3)])
def test_budget_boundary_returns_the_models_answer_from_read_evidence(session_factory, request_limit, tool_calls_limit, structured):
    contest_id = seed(session_factory)
    seen = []
    answer = '规则已写明奖金为一万元；报名截止还没有核实。'

    def respond(messages, info):
        prompts = (info.instructions or '') + '\n'.join(
            part.content for message in messages for part in message.parts
            if isinstance(part, (SystemPromptPart, UserPromptPart)))
        seen.append((len(info.function_tools), prompts))
        if info.function_tools:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['prize']}, tool_call_id=f'call-{len(seen)}')])
        results = [part.content for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        assert results[-1]['contest']['fields']['prize']['value'] == '一万元'
        if structured:
            assert 'respond_to_user' in {tool.name for tool in info.output_tools}
        return ModelResponse([answer_part(answer) if structured else TextPart(answer)])

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory,
        settings=LLMSettings(_env_file=None, request_limit=request_limit, tool_calls_limit=tool_calls_limit)))
    assert len(seen) == 3
    assert seen[-1][0] == 0 and all(count > 0 for count, _ in seen[:-1])
    assert '现在开始收尾' in seen[0][1]
    assert all(prompts.count('现在开始收尾') == 1 for _, prompts in seen)
    assert ('1 次模型请求' if request_limit == 3 else '1 次工具调用') in seen[-1][1]
    assert sum(event.type == 'observation' for event in events) == 2
    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert [source['url'] for source in events[-1].payload['sources']] == ['https://host.example/rules']


@pytest.mark.parametrize(('request_limit', 'tool_calls_limit'), [(1, 20), (20, 1)])
def test_a_single_remaining_step_is_reserved_for_a_model_answer(session_factory, request_limit, tool_calls_limit):
    def respond(_, info):
        assert info.function_tools == []
        return ModelResponse([TextPart('还没有读到可核实的参赛规则。')])

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory,
        settings=LLMSettings(_env_file=None, request_limit=request_limit, tool_calls_limit=tool_calls_limit)))
    assert [event.type for event in events] == ['answer']
    assert events[-1].payload['content'] == '还没有读到可核实的参赛规则。'


@pytest.mark.parametrize('limit', [3, 4])
def test_record_page_extraction_shares_usage_and_preserves_a_model_wrap_up(session_factory, limit):
    calls = []
    answer = '这次没有抽取到可保存的赛事字段，参赛日期仍未核实。'

    def respond(_, info):
        if info.output_tools[0].name != 'respond_to_user':
            calls.append('extract')
            return ModelResponse([ToolCallPart(info.output_tools[0].name, {'name': '公开比赛', 'claims': []})])
        calls.append('loop')
        if 'record_page' in {tool.name for tool in info.function_tools}:
            return ModelResponse([ToolCallPart('record_page', {'url': 'https://host.example/rules'}, tool_call_id=f'call-{len(calls)}')])
        return ModelResponse([TextPart(answer)])

    async def record(url, *, extractor, session_factory):
        await extractor(url, '公开比赛规则')
        return None

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record,
        settings=LLMSettings(_env_file=None, request_limit=limit, tool_calls_limit=20)))
    assert calls == ['loop', 'extract', 'loop']
    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert sum(event.type == 'observation' for event in events) == 1


def test_extraction_retries_cannot_spend_the_final_answer_request(session_factory):
    calls = []
    answer = '网页中的赛事字段尚未核实，不能据此给出确定的日期。'

    def respond(_, info):
        if info.output_tools[0].name != 'respond_to_user':
            calls.append('extract')
            return ModelResponse([TextPart('没有可供结构化的字段')])
        calls.append('loop')
        if info.function_tools:
            return ModelResponse([ToolCallPart('record_page', {'url': 'https://host.example/rules'})])
        return ModelResponse([TextPart(answer)])

    async def record(url, *, extractor, session_factory):
        await extractor(url, '赛事页面')
        return None

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory, record=record,
        settings=LLMSettings(_env_file=None, request_limit=4, tool_calls_limit=20)))
    assert calls == ['loop', 'extract', 'extract', 'loop']
    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert all(event.payload.get('summary') != '本次查询未完成，可尝试其他来源或方法。' for event in events)


@pytest.mark.parametrize('read_first', [False, True])
def test_hard_tool_limit_still_blocks_oversized_batches_without_retry_copy(session_factory, read_first):
    contest_id = seed(session_factory)
    calls = 0

    def respond(*_):
        nonlocal calls
        calls += 1
        count = 1 if read_first and calls == 1 else 4
        return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['prize']},
            tool_call_id=f'call-{calls}-{index}') for index in range(count)])

    events = run(Investigator(FunctionModel(respond), session_factory=session_factory,
        settings=LLMSettings(_env_file=None, request_limit=20, tool_calls_limit=3)))
    assert calls == (2 if read_first else 1)
    assert sum(event.type == 'observation' for event in events) == (1 if read_first else 0)
    assert events[-1].type == ('answer' if read_first else 'error')
    text = events[-1].payload.get('content', events[-1].payload.get('message'))
    assert '请稍后重试' not in text


def test_budget_wrap_up_keeps_model_prose_with_an_incomplete_verification_report(session_factory):
    contest_id = seed(session_factory)
    calls = 0
    answer = '库里的规则记载奖金为一万元，本轮还没有核实最新公告是否变化。'

    def respond(_, info):
        nonlocal calls
        calls += 1
        if info.function_tools:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['prize']})])
        return ModelResponse([TextPart(answer)])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory, mode='deep',
        search=lambda *_args, **_kwargs: [], search_provider='yuanbao',
        settings=LLMSettings(_env_file=None, request_limit=2, tool_calls_limit=20))

    async def consume():
        return [event async for event in investigator.ask('核对公开比赛的奖金规则', confirmed_claims=[
            {'id': 'prize', 'text': '比赛奖金是一万元', 'origin': 'user'}])]

    events = asyncio.run(consume())
    assert calls == 2
    assert events[-1].type == 'answer' and events[-1].payload['content'] == answer
    assert events[-1].payload['report']['status'] != 'complete'
