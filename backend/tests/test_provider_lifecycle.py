import asyncio
import json

import httpx
import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError

from contest_detective.server.agent import llm, loop
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.agent.extraction import create_page_extractor
from contest_detective.server.agent.loop import Investigator
from contest_detective.web.api import agent as web_agent


def local_provider(session_factory, monkeypatch, *, failure=False, pause=None):
    clients, requests = [], []
    real_client = llm.AsyncOpenAI
    async def respond(request):
        if pause is not None:
            started, resume = pause
            started.set()
            await resume.wait()
        payload = json.loads(request.content)
        requests.append(payload)
        if failure:
            return httpx.Response(503, json={'error': {'message': 'unavailable', 'type': 'server_error'}})
        if 'tools' in payload and any(tool['function']['name'] == 'final_result' for tool in payload['tools']):
            draft = {'name': '网页活动', 'page': {'url': 'https://organizer.example/event', 'site': '主办方', 'title': '活动', 'is_official': False},
                     'claims': [{'field': 'city', 'value': '杭州', 'excerpt': '杭州举办'}]}
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{
                'id': 'extracted', 'type': 'function', 'function': {'name': 'final_result', 'arguments': json.dumps(draft)},
            }]}
            finish = 'tool_calls'
        else:
            message, finish = {'role': 'assistant', 'content': '已读取资料。'}, 'stop'
        return httpx.Response(200, json={
            'id': 'response', 'object': 'chat.completion', 'created': 0, 'model': 'compatible-test',
            'choices': [{'index': 0, 'finish_reason': finish, 'message': message}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120},
        })
    def construct(**kwargs):
        client = real_client(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        clients.append(client)
        return client
    monkeypatch.setattr(llm, 'AsyncOpenAI', construct)
    monkeypatch.setattr(llm, 'get_llm_settings', lambda: LLMSettings(
        _env_file=None, enabled=True, limits_mode='external', deepseek_options=False,
        api_key='test-only', base_url='https://gateway.example/v1', model='compatible-test'))
    return clients, requests


@pytest.mark.parametrize('failure', [False, True])
def test_default_page_extractor_closes_its_client_on_success_or_failure(session_factory, monkeypatch, failure):
    clients, requests = local_provider(session_factory, monkeypatch, failure=failure)
    async def run():
        try:
            extractor = create_page_extractor(session_factory=session_factory)
            if failure:
                with pytest.raises(ModelHTTPError):
                    await extractor('https://organizer.example/event', '杭州举办')
            else:
                assert (await extractor('https://organizer.example/event', '杭州举办')).name == '网页活动'
            assert len(clients) == 1 and clients[0].is_closed()
        finally:
            for client in clients:
                await client.close()
    asyncio.run(run())
    assert len(requests) == 1


def test_page_extractor_does_not_close_a_borrowed_model(session_factory, monkeypatch):
    clients, _ = local_provider(session_factory, monkeypatch)
    async def run():
        model = llm.create_model(session_factory=session_factory)
        try:
            await create_page_extractor(model=model)('https://organizer.example/event', '杭州举办')
            assert not clients[0].is_closed()
        finally:
            await clients[0].close()
    asyncio.run(run())


def test_owned_model_closes_when_its_agent_context_exits(session_factory, monkeypatch):
    clients, _ = local_provider(session_factory, monkeypatch)
    async def run():
        try:
            model = llm.create_model(session_factory=session_factory)
            async with Agent(model) as agent:
                await agent.run('查资料')
            assert clients[0].is_closed()
        finally:
            for client in clients:
                await client.close()
    asyncio.run(run())


def test_http_responses_release_clients_even_when_rate_limited(client, session_factory, monkeypatch):
    clients, requests = local_provider(session_factory, monkeypatch)
    monkeypatch.setattr(web_agent, 'create_investigator', lambda **_: Investigator(
        llm.create_model(session_factory=session_factory), session_factory=session_factory))
    web_agent.limiter.reset()
    try:
        for _ in range(5):
            assert 'event: answer' in client.post('/agent/ask', json={'question': '查资料'}).text
        rejected = client.post('/agent/ask', json={'question': '查资料'})
        assert rejected.json()['code'] == 429
        assert len(clients) == 6 and all(owned.is_closed() for owned in clients)
        assert len(requests) == 5
    finally:
        web_agent.limiter.reset()
        for owned in clients:
            asyncio.run(owned.close())


def test_public_question_iterator_releases_its_client(session_factory, monkeypatch):
    clients, _ = local_provider(session_factory, monkeypatch)
    monkeypatch.setattr(loop, 'create_investigator', lambda: Investigator(
        llm.create_model(session_factory=session_factory), session_factory=session_factory))
    async def run():
        try:
            events = [event async for event in loop.ask('查资料')]
            assert events[-1].type == 'answer'
            assert clients[0].is_closed()
        finally:
            for client in clients:
                await client.close()
    asyncio.run(run())


def test_cancelled_page_extraction_closes_its_client(session_factory, monkeypatch):
    async def run():
        started, resume = asyncio.Event(), asyncio.Event()
        clients, _ = local_provider(session_factory, monkeypatch, pause=(started, resume))
        task = asyncio.create_task(create_page_extractor(session_factory=session_factory)(
            'https://organizer.example/event', '杭州举办'))
        try:
            await started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert clients[0].is_closed()
        finally:
            task.cancel()
            for client in clients:
                await client.close()
    asyncio.run(run())
