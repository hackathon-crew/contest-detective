import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from contest_detective.server.agent.extraction import ExtractedContest, create_page_extractor
from contest_detective.server.agent.normalization import NormalizedContest

FACTS = {
    'name': '公开赛事',
    'claims': [
        {'field': 'city', 'value': '上海', 'excerpt': '在上海参赛'},
        {'field': 'start_at', 'value': '尚未公布', 'excerpt': '开赛时间尚未公布'},
    ],
}


@pytest.mark.parametrize('schema', [ExtractedContest, NormalizedContest])
def test_one_invalid_optional_claim_does_not_discard_valid_facts(schema):
    result = schema.model_validate(FACTS)

    assert [(claim.field, claim.value) for claim in result.claims] == [('city', '上海')]


def test_page_extraction_keeps_valid_claims_without_retrying_the_whole_event():
    calls = []

    def respond(_messages, info):
        calls.append(1)
        return ModelResponse([ToolCallPart(info.output_tools[0].name, FACTS)],
                             usage=RequestUsage(input_tokens=100, output_tokens=20))

    result = asyncio.run(create_page_extractor(model=FunctionModel(respond))(
        'https://organizer.example/contest', '在上海参赛，开赛时间尚未公布',
    ))

    assert [(claim.field, claim.value) for claim in result.claims] == [('city', '上海')]
    assert len(calls) == 1
