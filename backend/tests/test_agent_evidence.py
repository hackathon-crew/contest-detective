import asyncio

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.tools import ToolDeps, register_tools
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft


@pytest.fixture
def evidence_deps(session_factory):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='证据按需赛', summary='公开开发活动', page={
            'url': 'https://host.example/schedule', 'site': '主办方', 'title': '比赛日程', 'is_official': True,
        }, claims=[{'field': 'submission_deadline', 'value': '2026-10-29', 'precision': 'day', 'excerpt': '10月29日提交'}]))
        service.save(session, ContestDraft(name='证据按需赛', page={
            'url': 'https://news.example/prize', 'site': '转载', 'title': '奖金公告', 'is_official': False,
        }, claims=[{'field': 'prize', 'value': '两万元', 'excerpt': '奖金两万元'}]), contest_id=contest_id)
    return ToolDeps(session_factory, FunctionModel(lambda *_: ModelResponse([TextPart('完成')]))), contest_id


def read(deps, contest_id, **arguments):
    called = False

    def respond(*_):
        nonlocal called
        if not called:
            called = True
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, **arguments})])
        return ModelResponse([TextPart('已读取')])

    agent = Agent(FunctionModel(respond), deps_type=ToolDeps)
    register_tools(agent, web_enabled=False, external_enabled=False)
    result = asyncio.run(agent.run('查比赛', deps=deps))
    return next(part for message in result.all_messages() for part in message.parts if isinstance(part, ToolReturnPart))


def test_get_contest_returns_only_requested_evidence_and_registers_its_sources(evidence_deps):
    deps, contest_id = evidence_deps
    result = read(deps, contest_id, fields=['submission_deadline', 'eligibility']).content
    contest = result['contest']
    assert set(contest) == {'id', 'name', 'status', 'fields'}
    assert set(contest['fields']) == {'submission_deadline', 'eligibility'}
    deadline = contest['fields']['submission_deadline']
    assert (deadline['value'], deadline['precision'], deadline['level']) == ('2026-10-29T00:00:00Z', 'day', 'official')
    source, = deadline['sources']
    assert (source['url'], source['title'], source['is_official'], source['excerpt']) == (
        'https://host.example/schedule', '比赛日程', True, '10月29日提交')
    assert contest['fields']['eligibility'] == {'value': None, 'precision': 'datetime', 'level': 'not_found', 'sources': []}
    assert set(deps.sources) == {'https://host.example/schedule'}
    assert [source['url'] for source in result['sources']] == ['https://host.example/schedule']
    assert deps.contest_ids == {contest_id}
    assert len(deps.observed_contests[contest_id]['fields']) == 17
    assert deps.observed_contests[contest_id]['fields']['prize']['value'] == '两万元'


def test_get_contest_uses_six_core_fields_when_fields_are_omitted(evidence_deps):
    deps, contest_id = evidence_deps
    result = read(deps, contest_id).content['contest']
    assert set(result['fields']) == {'start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified', 'city'}
    assert 'documents' not in result and 'introduction' not in result
    assert 'summary' not in result


@pytest.mark.parametrize('fields', [[], ['documents'], ['introduction'], ['unknown'],
    ['start_at', 'end_at', 'city', 'mode', 'prize', 'organizer', 'eligibility']])
def test_get_contest_rejects_invalid_field_selection_before_observation(evidence_deps, fields):
    deps, contest_id = evidence_deps
    result = read(deps, contest_id, fields=fields)
    assert result.outcome == 'retried'
    assert deps.observed_contests == {} and deps.contest_ids == set() and deps.sources == {}


def test_summary_is_returned_separately_without_field_evidence_or_sources(evidence_deps):
    deps, contest_id = evidence_deps
    result = read(deps, contest_id, fields=['summary']).content['contest']
    assert result['summary'] == '公开开发活动'
    assert result['fields'] == {}
    assert deps.sources == {}


def test_summary_can_be_selected_with_verified_fields(evidence_deps):
    deps, contest_id = evidence_deps
    result = read(deps, contest_id, fields=['summary', 'submission_deadline']).content['contest']
    assert result['summary'] == '公开开发活动'
    assert set(result['fields']) == {'submission_deadline'}
    assert result['fields']['submission_deadline']['level'] == 'official'
    assert set(deps.sources) == {'https://host.example/schedule'}


def test_a_requested_missing_summary_is_explicitly_null(evidence_deps):
    deps, _ = evidence_deps
    with deps.session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='未给简介', page={
            'url': 'https://host.example/no-summary', 'site': '主办方', 'title': '规则', 'is_official': True,
        }, claims=[]))
    result = read(deps, contest_id, fields=['summary']).content['contest']
    assert result['summary'] is None and result['fields'] == {}
