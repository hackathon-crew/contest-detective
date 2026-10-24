import asyncio
import json

import httpx
import pytest

from contest_detective.server.agent import normalization
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.contest.schemas import ContestDraft, PageIn
from contest_detective.server.research_pipeline.normalization import NormalizationInput


@pytest.mark.parametrize(('mode', 'expected_limit'), [('external', None), ('local', 2048)])
def test_normalizer_leaves_external_output_capacity_to_the_provider(monkeypatch, mode, expected_limit):
    requests = []
    facts = {'name': '公开赛事', 'claims': [{'field': 'city', 'value': '上海', 'excerpt': '在上海参赛'}]}

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            'id': 'response', 'object': 'chat.completion', 'created': 0, 'model': 'test-model',
            'choices': [{'index': 0, 'finish_reason': 'stop',
                         'message': {'role': 'assistant', 'content': json.dumps(facts)}}],
            'usage': {'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120},
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
            chat_model = normalization.ChatOpenAI
            monkeypatch.setattr(normalization, 'ChatOpenAI',
                                lambda **kwargs: chat_model(**kwargs, http_async_client=client))
            normalizer = normalization.create_normalizer(LLMSettings(
                _env_file=None, enabled=True, api_key='test-only', base_url='https://provider.example/v1',
                model='test-model', limits_mode=mode, max_tokens=2048,
            ))
            draft = ContestDraft(name='公开赛事', page=PageIn(
                url='https://organizer.example/contest', site='主办方', title='公开赛事', is_official=True,
            ), claims=[])
            return await normalizer(NormalizationInput(draft=draft, context='在上海参赛', context_url=draft.page.url))

    result = asyncio.run(run())

    assert result.claims[0].value == '上海'
    assert len(requests) == 1
    assert requests[0].get('max_tokens', requests[0].get('max_completion_tokens')) == expected_limit
