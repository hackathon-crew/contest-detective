import asyncio
from datetime import datetime, timedelta

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.tools import ToolDeps, register_tools
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft
from contest_detective.system.user import matching
from contest_detective.system.user.schemas import Profile


@pytest.fixture
def deps(session_factory, monkeypatch):
    now = datetime.fromisoformat('2026-10-27T15:00:00Z')
    monkeypatch.setattr(service, '_now', lambda: now)
    monkeypatch.setattr(matching, '_now', lambda: now)
    with session_factory() as session:
        for index in range(21):
            service.save(session, ContestDraft(name=f'Python 比赛 {index:02}', page={
                'url': f'https://organizer.example/{index}', 'site': '主办方',
                'title': '比赛规则', 'is_official': True,
            }, claims=[
                {'field': 'start_at', 'value': (now + timedelta(days=index + 1)).date().isoformat(),
                 'precision': 'day', 'excerpt': '开赛日期'},
                {'field': 'prize', 'value': '¥20,000', 'excerpt': '奖金两万元'},
            ]))
    return ToolDeps(session_factory=session_factory, model=FunctionModel(lambda *_: ModelResponse([TextPart('完成')])),
                    profile=Profile(skills=['Python']))


def call_tool(deps, name, arguments):
    seen = []

    def respond(messages, _):
        if not seen:
            seen.append(True)
            return ModelResponse([ToolCallPart(name, arguments)])
        return ModelResponse([TextPart('已选出候选')])

    agent = Agent(FunctionModel(respond), deps_type=ToolDeps)
    register_tools(agent, web_enabled=False, external_enabled=False)
    result = asyncio.run(agent.run('找比赛', deps=deps))
    return [part for message in result.all_messages() for part in message.parts
            if isinstance(part, ToolReturnPart)]


@pytest.mark.parametrize('tool', ['search_contests', 'match_contests'])
def test_retrieval_returns_briefs_with_pagination_and_keeps_server_side_evidence(deps, tool):
    first = call_tool(deps, tool, {'page': 1, 'page_size': 20})[-1].content
    assert first['total'] == 21 and first['page'] == 1 and first['page_size'] == 20
    assert first['has_more'] is True and len(first['items']) == 20
    second = call_tool(deps, tool, {'page': 2, 'page_size': 20})[-1].content
    assert second['has_more'] is False and len(second['items']) == 1
    cards = [item['contest'] if tool == 'match_contests' else item for item in first['items'] + second['items']]
    assert len({card['id'] for card in cards}) == 21
    assert all('fields' not in card and 'sources' not in card and 'coverage' not in card for card in cards)
    assert cards[0]['start_at'] == {'value': '2026-10-28', 'precision': 'day'}
    assert cards[0]['prize'] == '¥20,000'
    assert deps.contest_ids == {card['id'] for card in cards}
    assert all(len(item['fields']) == 17 for item in deps.observed_contests.values())
    assert all(item['fields']['prize']['value'] == '¥20,000' for item in deps.observed_contests.values())
    assert deps.sources == {}
    if tool == 'search_contests':
        assert all(item['fields']['prize']['sources'] for item in deps.observed_contests.values())
    else:
        assert first['items'][0]['score'] == 2
        assert 'Python' in first['items'][0]['reason']


@pytest.mark.parametrize('tool', ['search_contests', 'match_contests'])
def test_retrieval_rejects_page_size_above_twenty_before_observing_contests(deps, tool):
    results = call_tool(deps, tool, {'page_size': 21})
    assert len(results) == 1 and results[0].outcome == 'retried'
    assert results[0].content[0]['type'] == 'less_than_equal'
    assert deps.contest_ids == set() and deps.observed_contests == {} and deps.sources == {}


def test_explicit_history_search_keeps_past_deadlines(deps):
    with deps.session_factory() as session:
        service.save(session, ContestDraft(name='已过截止比赛', page={
            'url': 'https://organizer.example/old', 'site': '主办方', 'title': '往期规则', 'is_official': True,
        }, claims=[{'field': 'submission_deadline', 'value': '2026-10-20', 'precision': 'day', 'excerpt': '已过截止'}]))
    result = call_tool(deps, 'search_contests', {'keyword': '已过截止', 'status': 'ended'})[-1].content
    assert len(result['items']) == 1
    assert result['items'][0]['status'] == 'ended'
    assert result['items'][0]['next_deadline'] is None
