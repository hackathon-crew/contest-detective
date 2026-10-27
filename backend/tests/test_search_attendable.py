import asyncio

import pytest
import time_machine
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.tools import ToolDeps, register_tools
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft, ContestQuery
from contest_detective.system.account.schemas import SearchPreferences


def seed(session, name, **fields):
    return service.save(session, ContestDraft(name=name, page={
        'url': f'https://host.example/{name}', 'site': '主办方', 'title': name, 'is_official': True,
    }, claims=[{'field': field, 'value': value, 'precision': precision, 'excerpt': value}
               for field, (value, precision) in fields.items()]))


def call_tool(session_factory, name, arguments, *, preferences=None):
    called = False

    def respond(*_):
        nonlocal called
        if not called:
            called = True
            return ModelResponse([ToolCallPart(name, arguments)])
        return ModelResponse([TextPart('已查询')])

    agent = Agent(FunctionModel(respond), deps_type=ToolDeps)
    register_tools(agent, web_enabled=False, external_enabled=False)
    result = asyncio.run(agent.run('找比赛', deps=ToolDeps(session_factory, agent.model, preferences=preferences)))
    return next(part.content for message in result.all_messages() for part in message.parts if isinstance(part, ToolReturnPart))


def search(session_factory, *, preferences=None, **arguments):
    return call_tool(session_factory, 'search_contests', arguments, preferences=preferences)


@time_machine.travel('2026-10-27T15:59:59Z', tick=False)
def test_default_search_excludes_ended_or_any_expired_deadline_but_retains_unknown_deadlines(session_factory):
    with session_factory() as session:
        seed(session, '已结束', start_at=('2026-10-20', 'day'), end_at=('2026-10-26', 'day'))
        seed(session, '报名已过提交未过', start_at=('2026-10-29', 'day'),
             registration_deadline=('2026-10-26', 'day'), submission_deadline=('2026-10-30', 'day'))
        seed(session, '未给截止', start_at=('2026-10-29', 'day'))
        seed(session, '今天截止', start_at=('2026-10-29', 'day'), registration_deadline=('2026-10-27', 'day'))
        seed(session, '此刻截止', start_at=('2026-10-29', 'day'), submission_deadline=('2026-10-27T15:59:59Z', 'datetime'))
        seed(session, '刚刚截止', start_at=('2026-10-29', 'day'), deadline_unspecified=('2026-10-27T15:59:58Z', 'datetime'))
        # HTTP/MCP 使用的 query 默认仍可查历史。
        assert service.query(session, ContestQuery())[1] == 6
    result = search(session_factory)
    assert {item['name'] for item in result['items']} == {'未给截止', '今天截止', '此刻截止'}
    assert result['total'] == 3


@pytest.mark.parametrize('preferences', [None, SearchPreferences(exclude_ended=True), SearchPreferences(exclude_ended=False)])
def test_explicit_ended_status_can_search_and_read_history(session_factory, preferences):
    with session_factory() as session:
        contest_id = seed(session, '往期比赛', start_at=('2026-10-01', 'day'), end_at=('2026-10-02', 'day'))
    result = search(session_factory, preferences=preferences, status='ended')
    assert result['total'] == 1 and result['items'][0]['name'] == '往期比赛'
    detail = call_tool(session_factory, 'get_contest', {'contest_id': contest_id, 'fields': ['end_at']}, preferences=preferences)
    assert detail['contest']['id'] == contest_id and detail['contest']['status'] == 'ended'
    assert detail['contest']['fields']['end_at']['value'] == '2026-10-02T00:00:00Z'
    assert detail['contest']['fields']['end_at']['level'] == 'official'


@pytest.mark.parametrize(('preferences', 'expected'), [
    (None, {'未来赛事', '未给日期'}),
    (SearchPreferences(exclude_ended=True), {'未来赛事', '未给日期'}),
    (SearchPreferences(exclude_ended=False), {'未来赛事', '未给日期', '往期赛事', '报名已过'}),
])
def test_account_preference_controls_only_the_default_search_filter(session_factory, preferences, expected):
    with session_factory() as session:
        seed(session, '未来赛事', start_at=('2026-10-29', 'day'))
        seed(session, '未给日期', eligibility=('大学生', 'datetime'))
        seed(session, '往期赛事', start_at=('2026-10-01', 'day'), end_at=('2026-10-02', 'day'))
        seed(session, '报名已过', start_at=('2026-10-29', 'day'),
             registration_deadline=('2026-10-23', 'day'), submission_deadline=('2026-10-28', 'day'))
    result = search(session_factory, preferences=preferences)
    assert result['total'] == len(expected)
    assert {item['name'] for item in result['items']} == expected


@pytest.mark.parametrize('exclude_ended', [True, False])
def test_explicit_history_still_respects_blocked_source_domains(session_factory, exclude_ended):
    with session_factory() as session:
        contest_id = seed(session, '屏蔽往期赛事', start_at=('2026-10-01', 'day'), end_at=('2026-10-02', 'day'))
    preferences = SearchPreferences(exclude_ended=exclude_ended, blocked_domains=['host.example'])
    assert search(session_factory, preferences=preferences, status='ended')['total'] == 0
    assert call_tool(session_factory, 'get_contest', {'contest_id': contest_id}, preferences=preferences)['contest'] is None


@pytest.mark.parametrize('exclude_ended', [True, False])
def test_matching_keeps_its_own_attendance_filter(session_factory, exclude_ended):
    with session_factory() as session:
        contest_id = seed(session, '未来 Python 赛事', start_at=('2026-10-29', 'day'))
        seed(session, '往期比赛', start_at=('2026-10-01', 'day'), end_at=('2026-10-02', 'day'))
        seed(session, '报名已过', start_at=('2026-10-29', 'day'), registration_deadline=('2026-10-23', 'day'))
    result = call_tool(session_factory, 'match_contests', {'profile': {'skills': ['Python']}},
                       preferences=SearchPreferences(exclude_ended=exclude_ended))
    assert result['total'] == 1 and result['items'][0]['contest']['id'] == contest_id


@pytest.mark.parametrize(('clock', 'total'), [('2026-10-27T15:59:59Z', 1), ('2026-10-27T16:00:00Z', 0)])
def test_day_deadline_closes_at_the_end_of_its_beijing_day(session_factory, clock, total):
    with session_factory() as session:
        seed(session, '日精度截止', start_at=('2026-10-29', 'day'), deadline_unspecified=('2026-10-27', 'day'))
    with time_machine.travel(clock, tick=False):
        assert search(session_factory)['total'] == total


def test_completely_undated_contests_are_unknown_rather_than_ended(session_factory):
    with session_factory() as session:
        contest_id = seed(session, '未公布日程', eligibility=('大学生', 'datetime'))
        assert service.get(session, contest_id).status == 'upcoming'
    result = search(session_factory, preferences=SearchPreferences())
    assert result['total'] == 1 and result['items'][0]['id'] == contest_id
