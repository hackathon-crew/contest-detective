import asyncio
import httpx
import pytest
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from contest_detective.agent.loop import Investigator
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft


@pytest.mark.parametrize('batched', [False, True])
def test_bound_investigation_keeps_binding_and_stops_repeated_failed_pages(session_factory, batched):
    with session_factory() as session:
        contest_id = service.save(session, ContestDraft(name='科学挑战赛', page={
            'url': 'https://host.example/rules', 'site': '主办方', 'title': '规则', 'is_official': True,
        }, claims=[{'field': 'eligibility', 'value': '高校学生', 'excerpt': '高校学生可参加'}]))
    attempts, rounds = [], []
    url = 'https://host.example/rules'

    async def fetch(target):
        attempts.append(target)
        await asyncio.sleep(0)
        raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', target), response=httpx.Response(403))

    def respond(messages, info):
        tools = {t.name for t in info.function_tools}
        assert not tools & {'search_contests', 'match_contests'}
        rounds.append(tools)
        results = [p for m in messages for p in m.parts if isinstance(p, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('get_contest', {'contest_id': contest_id, 'fields': ['eligibility']})])
        if tools:
            return ModelResponse([ToolCallPart('fetch_page', {'url': url}, tool_call_id=f'{len(rounds)}-{i}')
                                  for i in range(2 if batched else 1)])
        assert any(p.tool_name == 'get_contest' and p.content['contest']['id'] == contest_id for p in results)
        return ModelResponse([TextPart('库内规则面向高校学生，官网本轮无法读取，最新资格尚未核实。')])

    async def consume():
        return [e async for e in Investigator(FunctionModel(respond), session_factory=session_factory,
                                              fetch=fetch).ask('核实参赛资格', contest_id=contest_id)]
    events = asyncio.run(consume())
    assert attempts == [url]
    assert len(rounds) <= 5
    assert events[-1].type == 'answer' and '高校学生' in events[-1].payload['content']
    assert events[-1].payload['sources'][0]['url'] == url
