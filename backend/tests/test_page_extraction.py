import asyncio
from decimal import Decimal

from pydantic_ai.messages import ModelResponse, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage
from sqlalchemy import select

from contest_detective.agent.budget import Budget
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.extraction import create_page_extractor
from contest_detective.agent.llm import GuardedModel
from contest_detective.agent.models import LLMUsage


def test_page_extractor_uses_the_shared_guard_and_preserves_full_page_text(session_factory):
    url = 'https://organizer.example/event'
    def respond(messages, info):
        content = next(part.content for message in messages for part in message.parts if isinstance(part, UserPromptPart))
        assert content.count('测') == 8000
        assert url in content
        draft = {'name': '网页活动', 'page': {'url': url, 'site': '主办方', 'title': '赛事', 'is_official': False},
                 'claims': [{'field': 'city', 'value': '杭州', 'excerpt': '杭州'}]}
        return ModelResponse([ToolCallPart(info.output_tools[0].name, draft)],
                             usage=RequestUsage(input_tokens=100, output_tokens=20))
    async def enough():
        return Decimal('100')
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    guarded = GuardedModel(FunctionModel(respond), Budget(session_factory, settings), balance_reader=enough)
    extracted = asyncio.run(create_page_extractor(model=guarded)(url, '测' * 8000))
    assert extracted.name == '网页活动'
    with session_factory() as session:
        usage = session.scalars(select(LLMUsage)).one()
        assert usage.status == 'settled'
        assert usage.cost_cny == Decimal('0.00036')


def test_production_extractor_construction_does_not_construct_a_provider(monkeypatch):
    import contest_detective.agent.llm as llm
    def forbidden(**_):
        raise RuntimeError('provider is disabled')
    monkeypatch.setattr(llm, 'create_model', forbidden)
    extractor = create_page_extractor()
    try:
        asyncio.run(extractor('https://organizer.example/event', '公开正文'))
    except RuntimeError as error:
        assert str(error) == 'provider is disabled'
    else:
        raise AssertionError('Extraction must pass through the production guard factory')
