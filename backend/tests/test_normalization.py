import asyncio
from decimal import Decimal

import pytest
from langchain_core.messages import AIMessage
from sqlalchemy import select
from pydantic import ValidationError

from contest_detective.server.agent.budget import Budget
from contest_detective.server.agent.config import LLMSettings
from contest_detective.server.agent.models import LLMUsage
from contest_detective.server.agent.normalization import (
    LangChainNormalizer,
    NormalizedContest,
    create_normalizer,
)
from contest_detective.server.agent.normalization_parser import parse_normalized, usage_from_response
from contest_detective.server.agent.normalization_prompts import build_messages, load_prompt
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.normalization import NormalizationInput


def item(context='赛事正文包含：地点：上海'):
    draft = ContestDraft(
        name='公开测试黑客松',
        page=PageIn(
            url='https://aggregator.example/event',
            site='aggregator.example',
            title='赛事',
            is_official=False,
        ),
        claims=[ClaimIn(field='mode', value='online', excerpt='线上参赛')],
    )
    return NormalizationInput(
        draft=draft,
        context=context,
        context_url='https://official.example/event',
    )


def test_output_schema_rejects_empty_name():
    with pytest.raises(ValidationError):
        NormalizedContest(name='', claims=[])


def test_prompt_separates_rules_and_single_contest_context():
    messages = build_messages(item())
    assert len(messages) == 2
    assert '适配器已经提供的字段不可覆盖' in messages[0].content
    assert '公开测试黑客松' in messages[1].content
    assert 'https://official.example/event' in messages[1].content
    assert '地点：上海' in messages[1].content


def test_parser_uses_parsed_output_and_raw_message():
    raw = AIMessage(
        content='{}',
        usage_metadata={
            'input_tokens': 10,
            'output_tokens': 4,
            'total_tokens': 14,
            'input_token_details': {'cache_read': 2},
        },
    )
    result = parse_normalized({
        'parsed': {'name': '赛事', 'claims': []},
        'raw': raw,
        'parsing_error': None,
    })
    assert result.output.name == '赛事'
    assert result.raw is raw
    usage = usage_from_response({
        'parsed': result.output.model_dump(),
        'raw': raw,
        'parsing_error': None,
    })
    assert usage.input_tokens == 10
    assert usage.cache_read_tokens == 2


def test_parser_recovers_fenced_json():
    parsed = parse_normalized(
        AIMessage(content='```json\n{"name":"赛事","claims":[]}\n```'),
    )
    assert parsed.output.name == '赛事'


def test_parser_rejects_missing_parsed_output():
    with pytest.raises(ValueError):
        parse_normalized({
            'parsed': None,
            'raw': AIMessage(content='not json'),
            'parsing_error': ValueError('bad'),
        })


def test_normalizer_merges_only_supported_new_claims():
    async def invoke(_item):
        return {
            'parsed': {
                'name': '模型不能覆盖的名称',
                'cover_url': 'https://official.example/cover.png',
                'summary': '官方赛事正文',
                'claims': [
                    {'field': 'mode', 'value': 'offline', 'excerpt': '线上参赛'},
                    {'field': 'city', 'value': '上海', 'excerpt': '地点：上海'},
                    {'field': 'prize', 'value': '不存在', 'excerpt': '没有这段'},
                ],
            },
            'raw': AIMessage(content='{}'),
            'parsing_error': None,
        }

    result = asyncio.run(LangChainNormalizer(invoke=invoke)(item()))
    assert result.name == '公开测试黑客松'
    assert result.summary == '官方赛事正文'
    assert [claim.field for claim in result.claims] == ['mode', 'city']
    assert result.claims[0].value == 'online'


def test_factory_disabled_does_not_construct_model(session_factory):
    settings = LLMSettings(_env_file=None, enabled=False)
    assert create_normalizer(settings, session_factory=session_factory) is None


def test_usage_rejects_missing_tokens():
    with pytest.raises(ValueError):
        usage_from_response(AIMessage(content='{}'))


def test_default_prompt_loads_from_package_when_cwd_is_unrelated(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert '结构化 schema' in load_prompt().render()


def test_budget_governance_settles_usage(session_factory):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    budget = Budget(session_factory, settings)
    raw = AIMessage(
        content='{}',
        usage_metadata={
            'input_tokens': 10,
            'output_tokens': 4,
            'total_tokens': 14,
        },
    )

    async def invoke():
        return raw

    async def run():
        from contest_detective.server.agent.normalization_governance import (
            LangChainBudgetGovernance,
        )

        return await LangChainBudgetGovernance(
            budget,
            balance_reader=lambda: asyncio.sleep(0, result=Decimal('100')),
        ).run(invoke, usage_from_response)

    assert asyncio.run(run()) is raw
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'settled'
        assert row.cost_cny > 0


def test_budget_governance_cancels_reservation_before_provider_request(session_factory):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    budget = Budget(session_factory, settings)
    called = False

    async def invoke():
        nonlocal called
        called = True
        raise AssertionError('provider request must be blocked')

    async def run():
        from contest_detective.server.agent.normalization_governance import (
            LangChainBudgetGovernance,
        )

        return await LangChainBudgetGovernance(
            budget,
            balance_reader=lambda: asyncio.sleep(0, result=Decimal('89.99')),
        ).run(invoke, usage_from_response)

    with pytest.raises(ValueError, match='余额'):
        asyncio.run(run())
    assert not called
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'cancelled'
        assert row.cost_cny == 0


def test_budget_governance_keeps_reservation_after_provider_error(session_factory):
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test-only')
    budget = Budget(session_factory, settings)

    async def invoke():
        raise RuntimeError('provider failed')

    async def run():
        from contest_detective.server.agent.normalization_governance import (
            LangChainBudgetGovernance,
        )

        return await LangChainBudgetGovernance(
            budget,
            balance_reader=lambda: asyncio.sleep(0, result=Decimal('100')),
        ).run(invoke, usage_from_response)

    with pytest.raises(RuntimeError, match='provider failed'):
        asyncio.run(run())
    with session_factory() as session:
        row = session.scalars(select(LLMUsage)).one()
        assert row.status == 'reserved'
        assert row.cost_cny == row.reserved_cny
