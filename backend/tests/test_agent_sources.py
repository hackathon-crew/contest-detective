import asyncio

import pytest

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part

from contest_detective.agent.loop import Investigator
from contest_detective.contest.schemas import ContestDraft
from contest_detective.contest.service import save


def test_final_sources_only_keep_read_and_cited_event_pages(session_factory):
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='周末黑客松', page={
            'url': 'https://organizer.example/rules', 'title': '参赛规则', 'site': '主办方', 'is_official': True,
        }, claims=[{'field': 'eligibility', 'value': '大学生', 'excerpt': '大学生可参加'}]))
        save(session, ContestDraft(name='周末黑客松', page={
            'url': 'https://hackertrip.space/event', 'title': '活动转载', 'site': 'HackerTrip', 'is_official': False,
        }, claims=[{'field': 'eligibility', 'value': '大学生', 'excerpt': '大学生可参加'}]), contest_id=contest_id)
        save(session, ContestDraft(name='周末黑客松', page={
            'url': 'https://devpost.com/api/hackathons?page=2',
            'title': 'Devpost official hackathon listing, page 2', 'site': 'Devpost', 'is_official': True,
        }, claims=[{'field': 'eligibility', 'value': '大学生', 'excerpt': '大学生可参加'}]), contest_id=contest_id)
        session.commit()

    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('web_search', {'query': '周末黑客松'})])
        if len(results) == 1:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['eligibility']})])
        if len(results) == 2:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://mlh.com/seasons/2027/events'})])
        return ModelResponse([answer_part('大学生可以参加：[参赛规则](https://organizer.example/rules)。'
            '[未读线索](https://directory.example/event) '
            '[列表](https://devpost.com/api/hackathons?page=2) '
            '[目录](https://mlh.com/seasons/2027/events)')])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *args, **kwargs: [{'title': '搜索线索', 'url': 'https://directory.example/event', 'site': '目录'}],
        fetch=lambda url: '大学生可以参加')

    async def consume():
        return [event async for event in investigator.ask('大学生可以参加吗？')]
    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    sources = {source['url']: source for source in events[-1].payload['sources']}
    assert sources['https://organizer.example/rules'].get('is_official') is True
    assert set(sources) == {'https://organizer.example/rules'}


@pytest.mark.parametrize('final_url', ['https://organizer.example/rules', 'https://organizer.example/rules-v2'])
def test_opened_search_result_keeps_its_title_and_excludes_other_hits(session_factory, final_url):
    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('web_search', {'query': '周末黑客松'})])
        if len(results) == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])
        assert results[-1].content['sources'][0]['title'] == '周末黑客松参赛规则'
        return ModelResponse([answer_part(f'已读取[比赛规则]({final_url})。')])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *args, **kwargs: [
            {'title': '周末黑客松参赛规则', 'url': 'https://organizer.example/rules', 'site': '主办方'},
            {'title': '未打开的线索', 'url': 'https://directory.example/event', 'site': '目录'},
        ], fetch=lambda url: {'url': final_url, 'text': '公开比赛规则'})

    async def consume():
        return [event async for event in investigator.ask('查周末黑客松规则')]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    assert [(source['url'], source['title']) for source in events[-1].payload['sources']] == [
        (final_url, '周末黑客松参赛规则'),
    ]


def test_search_summary_stays_on_one_line_without_repeating_lead_links(session_factory):
    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('web_search', {'query': '周末黑客松'})])
        assert results[-1].content['items'][0]['title'] == '周末黑客松参赛规则'
        return ModelResponse([answer_part('找到一条待查线索。')])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *args, **kwargs: [
            {'title': '周末黑客松参赛规则', 'url': 'https://organizer.example/rules', 'site': '主办方'},
        ])

    async def consume():
        return [event async for event in investigator.ask('查周末黑客松规则')]

    events = asyncio.run(consume())
    observation = next(event for event in events if event.type == 'observation')
    summary = observation.payload['summary']
    assert '\n' not in summary
    assert '周末黑客松参赛规则' not in summary and 'https://' not in summary
    assert events[-1].payload['sources'] == []


@pytest.mark.parametrize('structured', [False, True])
@pytest.mark.parametrize('failed_source', [False, True])
def test_model_answer_is_delivered_verbatim_after_empty_or_failed_research(session_factory, structured, failed_source):
    content = '  已查到的资料还不足以推荐。\n\n欢迎贴出你关注的比赛。  '

    def respond(messages, _):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('search_contests', {})])
        if len(results) == 1:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://host.example/rules'})
                if failed_source else ToolCallPart('web_search', {'query': '公开线上黑客松'})])
        return ModelResponse([answer_part(content) if structured else TextPart(content)])

    def unavailable(_):
        raise ValueError('no readable text')

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *_, **__: [], fetch=unavailable)

    async def consume():
        return [event async for event in investigator.ask('找线上比赛')]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer'
    assert events[-1].payload['content'] == content
