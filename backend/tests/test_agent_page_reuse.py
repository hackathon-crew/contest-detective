import asyncio

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, SystemPromptPart, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.agent.config import LLMSettings
from contest_detective.agent.loop import Investigator

URL = 'https://organizer.example/rules'


def run_pages(session_factory, fetch, requests):
    seen = []

    def respond(messages, info):
        results = [p.content for m in messages for p in m.parts if isinstance(p, ToolReturnPart)]
        seen[:] = results
        if len(results) < len(requests):
            assert info.function_tools, 'new page or segment must remain available'
            return ModelResponse([ToolCallPart('fetch_page', requests[len(results)])])
        return ModelResponse([TextPart('已读资料中的日期分别对应报名与决赛，尚未核实的部分保留。')])

    investigator = Investigator(FunctionModel(respond), session_factory=session_factory, fetch=fetch)

    async def consume():
        return [event async for event in investigator.ask('核实公开比赛的截止时间')]

    return asyncio.run(consume()), seen


@pytest.mark.parametrize('error_kind', ['403', '404', 'content', 'timeout', '429', '503'])
def test_failed_page_is_not_fetched_again_in_same_run(session_factory, monkeypatch, error_kind):
    attempts = []

    async def no_sleep(_):
        pass

    monkeypatch.setattr('contest_detective.agent.retry.sleep', no_sleep)

    def fetch(url):
        attempts.append(url)
        if error_kind == 'content':
            raise ValueError('unsupported media type')
        if error_kind == 'timeout':
            raise httpx.ReadTimeout('timed out')
        raise httpx.HTTPStatusError('unavailable', request=httpx.Request('GET', url),
                                    response=httpx.Response(int(error_kind)))

    events, results = run_pages(session_factory, fetch, [{'url': URL}, {'url': URL + '#details'}])
    assert len(attempts) == (3 if error_kind in {'timeout', '429', '503'} else 1)
    assert all(result['retryable'] is False for result in results)
    assert all(result['url'] == URL for result in results)
    assert all('无法读取' in event.payload['summary'] for event in events if event.type == 'observation')
    assert results[-1]['reused'] is True


def test_full_page_is_reused_for_new_segments_and_redirect_aliases(session_factory):
    fetched = []

    def fetch(url):
        fetched.append(url)
        return {'url': URL + '-final', 'text': '报名10月7日。决赛10月28日。'}

    _, results = run_pages(session_factory, fetch, [
        {'url': URL, 'length': 8}, {'url': URL + '#dates', 'offset': 8},
        {'url': URL + '-final', 'length': 8},
    ])
    assert fetched == [URL]
    assert results[0]['text'] == '报名10月7日。'
    assert results[1]['text'] == '决赛10月28日。'
    assert results[2]['text'] == results[0]['text']
    assert results[0]['next_offset'] == 8
    assert results[1]['next_offset'] is None


def test_transient_error_can_recover_before_page_is_cached(session_factory, monkeypatch):
    attempts = []

    async def no_sleep(_):
        pass

    monkeypatch.setattr('contest_detective.agent.retry.sleep', no_sleep)

    def fetch(url):
        attempts.append(url)
        if len(attempts) == 1:
            raise httpx.ReadTimeout('timed out')
        return '报名截止10月7日'

    _, results = run_pages(session_factory, fetch, [{'url': URL}, {'url': URL}])
    assert len(attempts) == 2
    assert results[1]['text'] == '报名截止10月7日'


def test_new_source_remains_available_after_a_repeated_failed_read(session_factory):
    fetched = []

    def fetch(url):
        fetched.append(url)
        if url == URL:
            raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', url), response=httpx.Response(403))
        return '决赛10月28日'

    events, results = run_pages(session_factory, fetch, [
        {'url': URL}, {'url': URL}, {'url': 'https://other.example/contest'},
    ])
    assert fetched == [URL, 'https://other.example/contest']
    assert results[-1]['text'] == '决赛10月28日'
    assert events[-1].type == 'answer'


@pytest.mark.parametrize('guarded', [True, False])
@pytest.mark.parametrize('failed', [True, False])
def test_repeated_page_reads_force_answer_before_request_ceiling(session_factory, failed, guarded):
    fetched, calls = [], []

    def fetch(url):
        fetched.append(url)
        if failed and url != URL:
            raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', url), response=httpx.Response(403))
        return '官网：创意提交10月1—7日；决赛10月27—28日。'

    def respond(messages, info):
        calls.append(bool(info.function_tools))
        results = [p.content for m in messages for p in m.parts if isinstance(p, ToolReturnPart)]
        if info.function_tools:
            url = URL if not results or not failed else 'https://directory.example/contest'
            return ModelResponse([ToolCallPart('fetch_page', {'url': url}, tool_call_id=f'call-{len(calls)}')])
        assert '创意提交10月1—7日' in str(results)
        prompts = '\n'.join(p.content for m in messages for p in m.parts if isinstance(p, (SystemPromptPart, UserPromptPart)))
        assert URL in prompts and '创意提交10月1—7日' in prompts
        if failed:
            assert 'https://directory.example/contest' in prompts
        return ModelResponse([TextPart('官网创意提交为10月1—7日，27—28日是决赛；第三方截止尚未核实。')])

    model = FunctionModel(respond)
    settings = LLMSettings(_env_file=None, enabled=True, api_key='test', limits_mode='external',
                           request_limit=20, tool_calls_limit=30)
    if guarded:
        from contest_detective.agent.budget import Budget
        from contest_detective.agent.llm import GuardedModel
        model = GuardedModel(model, Budget(session_factory, settings))
    investigator = Investigator(model, session_factory=session_factory, fetch=fetch, settings=settings)

    async def consume():
        return [event async for event in investigator.ask('核实比赛截止时间')]

    events = asyncio.run(consume())
    assert len(calls) <= 6
    assert len(fetched) == (2 if failed else 1)
    assert events[-1].type == 'answer'
    assert '27—28日是决赛' in events[-1].payload['content']


def test_batched_page_reads_share_one_fetch(session_factory):
    fetched = []

    async def fetch(url):
        fetched.append(url)
        await asyncio.sleep(0)
        return '比赛报名截止10月7日'

    def respond(messages, info):
        results = [p.content for m in messages for p in m.parts if isinstance(p, ToolReturnPart)]
        if not results:
            return ModelResponse([ToolCallPart('fetch_page', {'url': URL}, tool_call_id=f'batch-{i}') for i in range(2)])
        return ModelResponse([TextPart('已核对报名截止。')])

    async def consume():
        return [e async for e in Investigator(FunctionModel(respond), session_factory=session_factory, fetch=fetch).ask('核实比赛截止时间')]

    events = asyncio.run(consume())
    assert fetched == [URL]
    assert events[-1].type == 'answer'


def test_new_investigation_does_not_reuse_old_page_failures(session_factory):
    attempts = []

    def fetch(url):
        attempts.append(url)
        if len(attempts) == 1:
            raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', url), response=httpx.Response(403))
        return '比赛报名截止10月7日'

    run_pages(session_factory, fetch, [{'url': URL}])
    _, results = run_pages(session_factory, fetch, [{'url': URL}])
    assert len(attempts) == 2
    assert results[-1]['text'] == '比赛报名截止10月7日'


def test_repeated_failures_complete_over_http_with_read_sources(authenticated_client, session_factory):
    from contest_detective.bootstrap.api.agent import get_investigator
    from contest_detective.agent.models import Investigation
    from sqlalchemy import select

    def fetch(url):
        if url == URL:
            return '官网比赛报名截止10月7日'
        raise httpx.HTTPStatusError('forbidden', request=httpx.Request('GET', url), response=httpx.Response(403))

    def respond(messages, info):
        results = [p.content for m in messages for p in m.parts if isinstance(p, ToolReturnPart)]
        if info.function_tools:
            return ModelResponse([ToolCallPart('fetch_page', {'url': URL if not results else 'https://directory.example/contest'})])
        return ModelResponse([TextPart('官网记载报名截止10月7日；第三方来源无法读取，暂不能核实其不同日期。')])

    authenticated_client.app.dependency_overrides[get_investigator] = lambda: Investigator(
        FunctionModel(respond), session_factory=session_factory, fetch=fetch)
    response = authenticated_client.post('/agent/ask', json={'question': '核实比赛截止时间'})
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/event-stream')
    assert 'event: answer' in response.text
    assert '该来源无法读取' in response.text
    assert '官网记载报名截止10月7日' in response.text
    with session_factory() as session:
        assert session.scalars(select(Investigation)).one().status == 'completed'
