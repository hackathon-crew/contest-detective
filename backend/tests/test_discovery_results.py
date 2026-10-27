import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from agent_responses import answer_part
from contest_detective.agent.loop import Investigator


@pytest.mark.parametrize('interrupted,assessments', [(False, []), (False, [{
    'id': 'c1', 'text': '推荐线上AI黑客松', 'verdict': 'insufficient',
    'source_level': 'not_found', 'comparison': '候选已找到，截止时刻尚未核实。',
}]), (True, [])])
def test_deep_discovery_preserves_search_results_without_full_verification(session_factory, interrupted, assessments):
    calls = 0
    answer = '可以先看 AI Builders 黑客松，支持线上；11点是否截止尚未核实。\nhttps://example.devpost.com/'

    def respond(*_):
        nonlocal calls
        calls += 1
        if calls == 1:
            return ModelResponse([ToolCallPart('plan_investigation', {'plan': {
                'mode': 'deep', 'steps': [{'id': 's1', 'purpose': '寻找线上AI黑客松',
                    'query': '线上AI黑客松 RAG agent', 'claim_ids': ['c1']}],
            }})])
        if calls == 2:
            return ModelResponse([ToolCallPart('web_search', {'query': '线上AI黑客松 RAG agent', 'step_id': 's1'})])
        if interrupted:
            raise RuntimeError('provider-unavailable')
        part = answer_part(answer)
        part.args['assessments'] = assessments
        return ModelResponse([part])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory, mode='deep',
        search_provider='yuanbao', search=lambda *args, **kwargs: [{
            'title': 'AI Builders 黑客松', 'url': 'https://example.devpost.com/',
            'snippet': '线上AI应用黑客松', 'provider': 'yuanbao',
        }])

    async def consume():
        return [event async for event in investigator.ask('推荐适合RAG和LLM agent的线上黑客松，截止时间11点')]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer'
    assert events[-1].payload['report']['status'] != 'complete'
    assert 'AI Builders' in events[-1].payload['content']
    assert 'https://example.devpost.com/' in events[-1].payload['content']
    if not interrupted:
        assert events[-1].payload['content'] == answer
    assert any(event.type == 'observation' and event.payload['tool'] == 'web_search' for event in events)
