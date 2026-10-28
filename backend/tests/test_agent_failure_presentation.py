import asyncio
import json

import pytest
from fastapi.testclient import TestClient
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
        raise ValueError('provider_internal_failure')

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory,
        search=broken, fetch=broken, record=broken))
    assert seen[0]['model_hint']
    observation = next(event.payload for event in events if event.type == 'observation')
    assert observation['status'] == 'failure'
    assert 'model_hint' not in observation and 'error' not in observation
    assert 'ValueError' not in json.dumps(observation)
    assert '其他来源或方法' not in observation['summary']
    assert events[-1].type == 'answer'


@pytest.mark.parametrize('tool,args', [
    ('web_search', {'query': '公开比赛规则'}),
    ('fetch_page', {'url': 'https://host.example/rules'}),
    ('record_page', {'url': 'https://host.example/rules'}),
])
def test_unexpected_tool_bug_stops_the_run_instead_of_becoming_a_recoverable_lookup(session_factory, caplog, tool, args):
    calls = []

    def respond(*_):
        calls.append(True)
        return ModelResponse([ToolCallPart(tool, args)] if len(calls) == 1 else [TextPart('故障后仍继续回答。')])

    def broken(*_args, **_kwargs):
        raise RuntimeError('internal tool bug')

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory,
                                 search=broken, fetch=broken, record=broken))
    assert len(calls) == 1
    assert events[-1].type == 'error'
    assert '没能完成查证' in events[-1].payload['message']
    assert 'internal tool bug' not in json.dumps([event.payload for event in events])
    assert any(record.exc_info and isinstance(record.exc_info[1], RuntimeError) for record in caplog.records)


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
    UsageLimitExceeded('request_limit internal failure'),
])
def test_internal_interruption_reports_failure_without_claiming_a_search_found_nothing(session_factory, failure, caplog):
    def respond(*_):
        raise failure

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory))
    message = events[-1].payload['message']
    assert '没能完成查证' in message
    assert '没查到' not in message and '没有查到' not in message
    assert all(word not in message for word in ['internal', '步数', '重试', '模型', '上下文'])
    assert any(record.exc_info and record.exc_info[2] for record in caplog.records)


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


def test_startup_business_error_keeps_the_user_action(client, monkeypatch):
    message = '无法读取你保存的密钥，请到账户设置中重新保存。'

    def broken(**_):
        raise BizException(message, code=503)

    monkeypatch.setattr('contest_detective.agent.llm.create_model', broken)
    response = client.post('/agent/ask', json={'question': '核对公开比赛规则'})
    assert response.json()['code'] == 503
    assert response.json()['message'] == message


def test_unexpected_startup_error_reaches_the_handler_with_a_stack(client, monkeypatch, caplog):
    def broken(**_):
        raise RuntimeError('internal startup bug')

    monkeypatch.setattr('contest_detective.agent.llm.create_model', broken)
    with TestClient(client.app, raise_server_exceptions=False) as safe_client:
        response = safe_client.post('/agent/ask', json={'question': '核对公开比赛规则'})
    assert response.json()['code'] == 500
    assert 'internal startup bug' not in response.text
    assert any(record.exc_info and isinstance(record.exc_info[1], RuntimeError)
               for record in caplog.records)


def test_tool_business_errors_are_not_converted_to_model_recovery_hints(session_factory):
    message = '公共查证额度已用完。你可以到账户设置中填写自己的模型密钥后继续。'

    def record(*_args, **_kwargs):
        raise BizException(message, code=429)

    model = FunctionModel(lambda *_: ModelResponse([ToolCallPart('record_page', {'url': 'https://host.example/rules'})]))
    events = consume(Investigator(model, session_factory=session_factory, record=record))
    assert events[-1].type == 'error' and events[-1].payload['message'] == message
    assert not any(event.type == 'observation' for event in events)


@pytest.mark.parametrize('partial', [False, True])
def test_actionable_business_error_keeps_partial_evidence_when_available(session_factory, partial):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='周末创作赛', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '规则', 'is_official': True,
        }, claims=[{'field': 'prize', 'value': '一万元', 'excerpt': '奖金一万元'}]))
    message = '这些资料太长了，请先只问一场比赛或一项具体规则。'
    calls = 0

    def respond(*_):
        nonlocal calls
        calls += 1
        if partial and calls == 1:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['prize']})])
        raise BizException(message, code=400)

    events = consume(Investigator(FunctionModel(respond), session_factory=session_factory))
    payload = events[-1].payload
    assert message in payload.get('content', payload.get('message', ''))
    if partial:
        assert '一万元' in payload['content']
        assert payload['sources'][0]['url'] == 'https://host.example/rules'


@pytest.mark.parametrize('cause', ['quota', 'low_balance', 'balance_unavailable'])
def test_real_budget_failures_explain_the_problem_and_a_possible_user_action(session_factory, cause):
    from decimal import Decimal
    import httpx
    from contest_detective.agent.budget import Budget
    from contest_detective.agent.config import LLMSettings
    from contest_detective.agent.llm import GuardedModel

    async def balance():
        if cause == 'quota':
            pytest.fail('exhausted quota must be rejected before checking balance')
        if cause == 'balance_unavailable':
            raise httpx.ConnectError('internal balance service failure')
        return Decimal('1')

    config = LLMSettings(_env_file=None, enabled=True, api_key='test-only',
                         budget_cny=Decimal('0.01') if cause == 'quota' else Decimal('1.5'))
    model = GuardedModel(FunctionModel(lambda *_: pytest.fail('blocked request must not reach the model')),
                         Budget(session_factory, config), balance_reader=balance)
    events = consume(Investigator(model, session_factory=session_factory))
    message = events[-1].payload['message']
    assert '没有查到' not in message and 'internal' not in message
    if cause == 'balance_unavailable':
        assert '暂时无法确认' in message and '余额' in message
    else:
        assert ('额度已用完' if cause == 'quota' else '余额不足') in message
        assert '账户设置' in message and '自己的模型密钥' in message
        assert '明天' not in message


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
