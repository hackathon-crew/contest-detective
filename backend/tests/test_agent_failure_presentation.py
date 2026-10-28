import asyncio
import json

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.loop import Investigator
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft
from contest_detective.framework.exceptions import BizException
from contest_detective.agent.verification import VerificationState, render_report
from contest_detective.agent.verification_contracts import ConfirmedClaim


def consume(investigator):
    async def run():
        return [event async for event in investigator.ask('核对公开比赛的奖金和报名截止')]
    return asyncio.run(run())


@pytest.mark.parametrize('tool,args', [
    ('web_search', {'query': '公开比赛规则'}),
    ('fetch_page', {'url': 'https://host.example/rules'}),
    ('record_page', {'url': 'https://host.example/rules'}),
])
def test_tool_failures_have_public_status_but_model_guidance_stays_private(session_factory, tool, args):
    seen = []

    def respond(messages, _):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart(tool, args)])
        seen.append(results[-1].content)
        return ModelResponse([TextPart('尚未读到参赛规则，奖金和报名截止仍未核实。')])

    def broken(*args, **kwargs):
        raise RuntimeError('provider_internal_failure')

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory,
        search=broken, fetch=broken, record=broken))
    assert seen[0]['model_hint']
    observation = next(event.payload for event in events if event.type == 'observation')
    assert observation['status'] == 'failure'
    assert 'model_hint' not in observation and 'error' not in observation
    assert 'RuntimeError' not in json.dumps(observation)
    assert '其他来源或方法' not in observation['summary']
    assert events[-1].type == 'answer'


@pytest.mark.parametrize('tool', ['fetch_page', 'record_page'])
def test_unavailable_tools_are_failed_instead_of_successful_steps(session_factory, tool):
    calls = 0

    def respond(*_):
        nonlocal calls
        calls += 1
        return ModelResponse([ToolCallPart(tool, {'url': 'https://host.example/rules'})] if calls == 1
                             else [TextPart('网页资料还没有核实。')])

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory))
    observation = next(event.payload for event in events if event.type == 'observation')
    assert observation['status'] == 'failure'
    assert '配置' not in observation['summary']


@pytest.mark.parametrize('failure', [
    RuntimeError('provider_internal_failure'),
    BizException('model_internal_failure', code=400),
    UsageLimitExceeded('request_limit internal failure'),
])
def test_empty_interruption_explains_missing_results_without_retry_or_raw_error(session_factory, failure):
    def respond(*_):
        raise failure

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory))
    message = events[-1].payload['message']
    assert '尚未' in message or '还没有' in message
    assert '核实' in message
    assert all(word not in message for word in ['internal', '步数', '重试', '模型', '上下文'])


def test_interruption_answers_with_only_fields_actually_read_not_tool_summaries(session_factory):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='周末创作赛', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '参赛规则', 'is_official': True,
        }, claims=[
            {'field': 'prize', 'value': '一万元', 'excerpt': '奖金一万元'},
            {'field': 'eligibility', 'value': '未读取的资格细节', 'excerpt': '未读取的资格细节'},
        ]))
    calls = 0

    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['prize']})])
        raise RuntimeError('provider_internal_failure')

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory))
    answer = events[-1].payload['content']
    assert '周末创作赛' in answer and '奖金' in answer and '一万元' in answer
    assert 'https://host.example/rules' in answer
    assert '未核实' in answer
    assert '未读取的资格细节' not in answer
    assert '已读取 周末创作赛 的字段与出处' not in answer


def test_candidates_and_unopened_leads_are_useful_but_not_presented_as_verified_facts(session_factory):
    with session_factory() as session:
        service.save(session, ContestDraft(name='周末创作赛', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '规则', 'is_official': True,
        }, claims=[{'field': 'prize', 'value': '不能当作已读事实', 'excerpt': '不能当作已读事实'}]))
    calls = 0

    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('search_contests', {})])
        if calls == 2:
            return ModelResponse([ToolCallPart('web_search', {'query': '公开比赛规则'})])
        raise RuntimeError('provider_internal_failure')

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *_args, **_kwargs: [{'title': '报名公告', 'url': 'https://host.example/notice', 'site': '主办方'}]))
    answer = events[-1].payload['content']
    assert '周末创作赛' in answer and '候选' in answer
    assert '报名公告' in answer and '未读取' in answer
    assert events[-1].payload['sources'] == []
    assert '不能当作已读事实' not in answer and '本页' not in answer


def test_model_initialization_errors_are_safe_before_the_stream(client, monkeypatch):
    def broken(**_):
        raise BizException('internal_model_configuration', code=503)

    monkeypatch.setattr('contest_detective.agent.llm.create_model', broken)
    response = client.post('/agent/ask', json={'question': '核对公开比赛规则'})
    assert response.json()['code'] == 503
    assert 'internal' not in response.json()['message']
    assert '核实' in response.json()['message']


def test_incomplete_report_describes_unverified_claims_instead_of_execution_requirements():
    state = VerificationState('deep', '核对公开比赛奖金', [
        ConfirmedClaim(id='internal-claim-id', text='比赛奖金是一万元', origin='user'),
    ])
    report = state.build([], interrupted=True)
    text = render_report(report)
    assert report.status == 'blocked'
    assert '比赛奖金是一万元' in text
    assert '尚未核实' in text
    assert all(word not in text for word in ['元宝', '计划', '证据链', 'internal-claim-id', '执行轨迹'])


def test_recommendation_failure_keeps_the_answer_already_written(session_factory, monkeypatch):
    answer = '已经读到报名规则，但奖金尚未核实。'

    def broken(*_):
        raise RuntimeError('internal card error')

    monkeypatch.setattr('contest_detective.agent.loop.materialize', broken)
    events = consume(Investigator(FunctionModel(lambda *_: ModelResponse([TextPart(answer)])),
                                 session_factory=session_factory))
    assert events[-1].type == 'answer'
    assert answer in events[-1].payload['content']
