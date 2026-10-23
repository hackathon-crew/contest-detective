import asyncio
import json

import httpx
import pytest

from contest_detective.common.exceptions import BizException
from contest_detective.server.agent import llm
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.user.resume import create_profile_extractor, parse_resume
from contest_detective.web.api.profile import get_resume_extractor


def provider(monkeypatch, *, failure=False, pause=None):
    clients = []
    client_type = llm.AsyncOpenAI

    async def respond(request):
        if pause:
            started, resume = pause
            started.set()
            await resume.wait()
        if failure:
            return httpx.Response(503, json={'error': {'message': 'unavailable', 'type': 'server_error'}})
        body = json.loads(request.content)
        name = body['tools'][0]['function']['name']
        return httpx.Response(200, json={'id': 'profile', 'object': 'chat.completion', 'created': 0,
            'model': 'test-provider', 'choices': [{'index': 0, 'finish_reason': 'tool_calls', 'message': {
                'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'result', 'type': 'function',
                    'function': {'name': name, 'arguments': json.dumps({'skills': ['Python']})}}]}}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120}})

    def construct(**kwargs):
        client = client_type(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
        clients.append(client)
        return client

    monkeypatch.setattr(llm, 'AsyncOpenAI', construct)
    monkeypatch.setattr(llm, 'get_llm_settings', lambda: LLMSettings(_env_file=None, enabled=True,
        limits_mode='external', deepseek_options=False, api_key='test-only', base_url='https://model.example/v1', model='test-provider'))
    return clients


@pytest.mark.parametrize('failure', [False, True])
def test_production_resume_dependency_closes_owned_client_on_success_or_failure(session, monkeypatch, failure):
    clients = provider(monkeypatch, failure=failure)

    async def run():
        try:
            extractor = get_resume_extractor(session=session)
            if failure:
                with pytest.raises(BizException):
                    await parse_resume(b'Python', filename='resume.txt', extractor=extractor)
            else:
                profile = await parse_resume(b'Python', filename='resume.txt', extractor=extractor)
                assert profile.skills == ['Python']
            assert len(clients) == 1
            assert clients[0].is_closed()
        finally:
            for client in clients:
                await client.close()

    asyncio.run(run())


def test_resume_does_not_close_a_borrowed_model(session_factory, monkeypatch):
    clients = provider(monkeypatch)

    async def run():
        model = llm.create_model(session_factory=session_factory)
        try:
            extractor = create_profile_extractor(model_factory=lambda: model)
            assert (await parse_resume(b'Python', filename='resume.txt', extractor=extractor)).skills == ['Python']
            assert not clients[0].is_closed()
        finally:
            await clients[0].close()

    asyncio.run(run())


def test_cancelled_resume_extraction_releases_owned_client(session, monkeypatch):
    async def run():
        started, resume = asyncio.Event(), asyncio.Event()
        clients = provider(monkeypatch, pause=(started, resume))
        task = asyncio.create_task(parse_resume(b'Python', filename='resume.txt', extractor=get_resume_extractor(session=session)))
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
