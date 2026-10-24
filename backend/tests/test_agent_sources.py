import asyncio

from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.server.agent.loop import Investigator
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.contest.service import save


def test_final_sources_distinguish_verified_official_pages_from_search_leads(session_factory):
    with session_factory() as session:
        contest_id = save(session, ContestDraft(name='周末黑客松', page={
            'url': 'https://organizer.example/rules', 'title': '参赛规则', 'site': '主办方', 'is_official': True,
        }, claims=[{'field': 'eligibility', 'value': '大学生', 'excerpt': '大学生可参加'}]))
        save(session, ContestDraft(name='周末黑客松', page={
            'url': 'https://hackertrip.space/event', 'title': '活动转载', 'site': 'HackerTrip', 'is_official': False,
        }, claims=[{'field': 'eligibility', 'value': '大学生', 'excerpt': '大学生可参加'}]), contest_id=contest_id)
        session.commit()

    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('web_search', {'query': '周末黑客松'})])
        if len(results) == 1:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id})])
        if len(results) == 2:
            return ModelResponse([ToolCallPart('fetch_page', {'url': 'https://organizer.example/rules'})])
        return ModelResponse([TextPart('大学生可以参加：[参赛规则](https://organizer.example/rules)。')])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory,
        search=lambda *args, **kwargs: [{'title': '搜索线索', 'url': 'https://directory.example/event', 'site': '目录'}],
        fetch=lambda url: '大学生可以参加')

    async def consume():
        return [event async for event in investigator.ask('大学生可以参加吗？')]
    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    sources = {source['url']: source for source in events[-1].payload['sources']}
    assert sources['https://organizer.example/rules'].get('is_official') is True
    assert sources['https://directory.example/event'].get('is_official') is False
    assert sources['https://hackertrip.space/event'].get('is_official') is False
