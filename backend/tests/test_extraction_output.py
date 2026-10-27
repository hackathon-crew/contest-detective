import asyncio

import httpx
from openai import AsyncOpenAI
from pydantic import ValidationError
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage, RunUsage
import pytest
from sqlalchemy import select

from contest_detective.agent import llm
from contest_detective.agent.budget import Budget
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.extraction import create_page_extractor
from contest_detective.agent.llm import GuardedModel
from contest_detective.agent.models import LLMUsage

URL = 'https://amazonappdev2026.devpost.com/'
FACTS = {'name': '正文赛事', 'summary': '在上海参赛', 'cover_url': None,
         'claims': [{'field': 'city', 'value': '上海', 'excerpt': '在上海参赛'}]}


def response(info, payload):
    return ModelResponse([ToolCallPart(info.output_tools[0].name, payload)],
                         usage=RequestUsage(input_tokens=100, output_tokens=20))


def guarded(session_factory, respond, *, client=None):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only', limits_mode='external')
    return GuardedModel(FunctionModel(respond), Budget(session_factory, settings), owned_client=client)


@pytest.mark.parametrize('forged_page', [None, {
    'url': 'https://invented.example/', 'site': '自报站点', 'title': '自报页面', 'is_official': False,
}])
def test_provider_extracts_facts_without_controlling_trusted_page_metadata(session_factory, forged_page):
    schemas = []
    def respond(_, info):
        schemas.append(info.output_tools[0].parameters_json_schema)
        return response(info, FACTS if forged_page is None else {**FACTS, 'page': forged_page})
    result = asyncio.run(create_page_extractor(model=guarded(session_factory, respond))(URL, '在上海参赛'))
    assert 'page' not in schemas[0]['properties']
    assert result.name == '正文赛事' and result.claims[0].excerpt == '在上海参赛'
    assert result.page.url == URL and result.page.site == 'amazonappdev2026.devpost.com'
    assert result.page.title == result.name and result.page.is_official


def test_invalid_claim_objects_get_two_library_corrections_and_each_request_is_accounted(session_factory):
    calls, feedback = 0, []
    def respond(messages, info):
        nonlocal calls
        calls += 1
        assert info.model_settings['max_retries'] == 0 and 'max_tokens' not in info.model_settings
        if calls in (1, 2):
            return response(info, {**FACTS, 'claims': ['city: 上海']})
        feedback.extend(part for message in messages for part in message.parts
                        if isinstance(part, ToolReturnPart) and part.outcome == 'retried')
        return response(info, FACTS)
    usage = RunUsage()
    extracted = asyncio.run(create_page_extractor(model=guarded(session_factory, respond), usage=usage)(URL, '在上海参赛'))
    assert calls == usage.requests == 3 and feedback
    assert extracted.claims[0].field == 'city' and extracted.claims[0].value == '上海'
    with session_factory() as session:
        rows = session.scalars(select(LLMUsage)).all()
        assert len(rows) == 3 and all(row.status == 'settled' for row in rows)
        assert sum(row.cache_miss_tokens for row in rows) == 300
        assert sum(row.output_tokens for row in rows) == 60


@pytest.mark.parametrize('claims', [['city: 上海'], [{'field': 'city', 'value': '上海'}]])
def test_persistently_invalid_claims_fail_after_three_requests_without_coercion(session_factory, claims):
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response(info, {**FACTS, 'claims': claims})
    with pytest.raises(UnexpectedModelBehavior) as error:
        asyncio.run(create_page_extractor(model=guarded(session_factory, respond))(URL, '在上海参赛'))
    assert calls == 3
    cause = error.value
    while cause is not None and not isinstance(cause, ValidationError):
        cause = cause.__cause__
    assert isinstance(cause, ValidationError)
    with session_factory() as session:
        assert len(session.scalars(select(LLMUsage)).all()) == 3


def test_correction_uses_the_shared_six_request_budget(session_factory):
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response(info, {**FACTS, 'claims': ['city: 上海']})
    usage = RunUsage(requests=5)
    with pytest.raises(UsageLimitExceeded):
        asyncio.run(create_page_extractor(model=guarded(session_factory, respond), usage=usage)(URL, '在上海参赛'))
    assert calls == 1 and usage.requests == 6
    with session_factory() as session:
        assert len(session.scalars(select(LLMUsage)).all()) == 1


@pytest.mark.parametrize('valid', [True, False])
def test_owned_sdk_client_closes_after_success_or_exhausted_output_correction(session_factory, monkeypatch, valid):
    calls = 0
    def respond(_, info):
        nonlocal calls
        calls += 1
        return response(info, FACTS if valid else {**FACTS, 'claims': ['city: 上海']})
    async def run():
        def no_network(_):
            raise AssertionError('Only FunctionModel is used')
        client = AsyncOpenAI(api_key='test-only', http_client=httpx.AsyncClient(transport=httpx.MockTransport(no_network)))
        owned = guarded(session_factory, respond, client=client)
        monkeypatch.setattr(llm, 'create_model', lambda **_: owned)
        try:
            if valid:
                assert (await create_page_extractor()(URL, '在上海参赛')).name == '正文赛事'
            else:
                with pytest.raises(UnexpectedModelBehavior):
                    await create_page_extractor()(URL, '在上海参赛')
            assert client.is_closed()
        finally:
            await client.close()
    asyncio.run(run())
    assert calls == (1 if valid else 3)
