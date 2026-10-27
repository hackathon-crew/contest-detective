import asyncio
import json

import httpx
from pydantic_ai import Agent
from sqlalchemy import select

from contest_detective.agent import llm
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.models import LLMUsage


def test_neutral_provider_sends_no_vendor_options_or_local_output_caps(session_factory, monkeypatch):
    real_client = llm.AsyncOpenAI
    requests = []
    def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert 'thinking' not in payload
        assert 'max_tokens' not in payload
        assert 'max_completion_tokens' not in payload
        assert payload['messages'][0]['content'] == '查询'
        return httpx.Response(200, json={
            'id': 'local-response', 'object': 'chat.completion', 'created': 0, 'model': 'compatible-test',
            'choices': [{'index': 0, 'finish_reason': 'stop', 'message': {'role': 'assistant', 'content': '已读取资料。'}}],
            'usage': {'prompt_tokens': 1000, 'completion_tokens': 100, 'total_tokens': 1100},
        })
    async def request():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            monkeypatch.setattr(llm, 'AsyncOpenAI', lambda **kwargs: real_client(**kwargs, http_client=client))
            settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only',
                                   limits_mode='external', deepseek_options=False,
                                   base_url='https://gateway.example/v1', model='compatible-test')
            model = llm.create_model(settings, session_factory=session_factory)
            result = await Agent(model, model_settings={'extra_body': {
                'thinking': {'type': 'enabled'}, 'max_tokens': 999999,
                'messages': [{'role': 'user', 'content': 'untrusted override'}],
            }}).run('查询')
            return result.output
    assert asyncio.run(request()) == '已读取资料。'
    assert len(requests) == 1
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'settled' and (row.cache_miss_tokens, row.output_tokens) == (1000, 100)
