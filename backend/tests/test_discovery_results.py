import asyncio
import re

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
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


@pytest.mark.parametrize('mode', [None, 'deep'])
@pytest.mark.parametrize('read_result', [None, 'direct', 'redirect', 'rejected'])
def test_interruption_lists_only_unopened_search_leads_as_unread(session_factory, mode, read_result):
    first_url = 'https://organizer.example/rules'
    final_url = 'https://organizer.example/rules-v2' if read_result == 'redirect' else first_url
    unread_url = 'https://directory.example/event'

    def respond(messages, info):
        results = [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]
        if mode == 'deep' and not results:
            return ModelResponse([ToolCallPart('plan_investigation', {'plan': {
                'mode': 'deep', 'steps': [{'id': 's1', 'purpose': '查黑客松规则',
                    'query': '周末黑客松规则', 'claim_ids': ['c1']}],
            }})])
        if not any(part.tool_name == 'web_search' for part in results):
            arguments = {'query': '周末黑客松规则'}
            if mode == 'deep':
                arguments['step_id'] = 's1'
            return ModelResponse([ToolCallPart('web_search', arguments)])
        if read_result and not any(part.tool_name == 'fetch_page' for part in results):
            return ModelResponse([ToolCallPart('fetch_page', {'url': first_url})])
        raise RuntimeError('provider-unavailable')

    def fetch(url):
        if read_result == 'rejected':
            raise PermissionError('redirect rejected')
        return {'url': final_url, 'text': '公开黑客松规则'}

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory, mode=mode,
        search_provider='yuanbao', search=lambda *args, **kwargs: [
            {'title': '主办方规则', 'url': first_url, 'site': '主办方', 'provider': 'yuanbao'},
            {'title': '其他黑客松线索', 'url': unread_url, 'site': '目录', 'provider': 'yuanbao'},
        ], fetch=fetch)

    async def consume():
        return [event async for event in investigator.ask('查公开黑客松规则')]

    events = asyncio.run(consume())
    assert events[-1].type == 'answer', events[-1].payload
    answer = events[-1].payload
    unread_text = '\n'.join(paragraph for paragraph in answer['content'].split('\n\n')
                            if '尚未读取原文' in paragraph)
    unread_links = set(re.findall(r'\]\((https?://[^)]+)\)', unread_text))
    expected_unread = {unread_url}
    if read_result not in {'direct', 'redirect'} and not (mode == 'deep' and read_result == 'rejected'):
        expected_unread.add(first_url)
    assert unread_links == expected_unread
    if read_result in {'direct', 'redirect'}:
        assert answer['content'].count(f']({final_url})') == 1
        assert [source['url'] for source in answer['sources']] == [final_url]
    else:
        assert answer['sources'] == []
        if mode == 'deep' and read_result == 'rejected':
            assert first_url not in answer['content']
