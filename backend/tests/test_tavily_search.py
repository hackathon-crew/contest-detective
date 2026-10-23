import json

import httpx
import pytest


def test_tavily_maps_basic_search_and_site_restrictions_without_answer_generation():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    def handle(request):
        assert str(request.url) == 'https://api.tavily.com/search'
        assert request.headers['Authorization'] == 'Bearer test-key'
        assert json.loads(request.content) == {
            'query': '黑客松', 'search_depth': 'basic', 'max_results': 2,
            'include_answer': False, 'include_raw_content': False,
            'auto_parameters': False, 'include_domains': ['mp.weixin.qq.com'],
        }
        return httpx.Response(200, json={'results': [
            {'title': '公开活动', 'url': 'https://mp.weixin.qq.com/s/one', 'content': '报名截止周五',
             'published_date': '2026-10-23'},
            {'title': '规则', 'url': 'https://mp.weixin.qq.com/s/two', 'content': '赛程原文'},
            {'title': '坏链接', 'url': 'javascript:alert(1)', 'content': '不进入结果'},
        ]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        hits = TavilySearch(api_key='test-key', client=client).search('黑客松', site='mp.weixin.qq.com', count=2)
    assert [item.url for item in hits] == ['https://mp.weixin.qq.com/s/one', 'https://mp.weixin.qq.com/s/two']
    assert hits[0].provider == 'tavily'
    assert hits[0].date == '2026-10-23'
    assert hits[0].snippet == '报名截止周五'


def test_tavily_limits_results_to_twenty_and_maps_exclusions():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    def handle(request):
        body = json.loads(request.content)
        assert body['max_results'] == 20
        assert body['exclude_domains'] == ['example.org', 'example.net']
        return httpx.Response(200, json={'results': [
            {'url': f'https://source.example/{index}', 'content': '原文'} for index in range(30)
        ]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        hits = TavilySearch(api_key='test-key', client=client).search('黑客松',
            site='exclude:example.org|example.net', count=50)
    assert len(hits) == 20


@pytest.mark.parametrize('count', [0, 51])
def test_tavily_rejects_invalid_result_counts(count):
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    with pytest.raises(ValueError):
        TavilySearch(api_key='test-key').search('黑客松', count=count)


def test_tavily_sanitizes_error_payloads():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={
        'detail': {'error': 'private provider response'},
    }))) as client:
        with pytest.raises(ValueError, match='搜索服务暂时不可用') as caught:
            TavilySearch(api_key='test-key', client=client).search('黑客松')
    assert 'private' not in str(caught.value)


@pytest.mark.parametrize('with_yuanbao', [False, True])
def test_configured_search_uses_tavily_and_preserves_yuanbao_priority(monkeypatch, with_yuanbao):
    from contest_detective.framework.config.search import SearchSettings
    from contest_detective.server import research_pipeline
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    def handle(request):
        if request.url.host == 'api.tavily.com':
            return httpx.Response(200, json={'results': [
                {'url': 'https://common.example/one', 'content': '共同来源'},
                {'url': 'https://tavily-only.example/one', 'content': '补充来源'},
            ]})
        assert request.url.host == 'api.wsa.cloud.tencent.com'
        return httpx.Response(200, json={'Response': {'Pages': [json.dumps({'url': url}) for url in [
            'https://common.example/one', 'https://yuanbao-only.example/one',
        ]]}})

    config = SearchSettings(yuanbao_api_key='test-key' if with_yuanbao else None, tavily_api_key='test-key')
    monkeypatch.setattr(research_pipeline, 'get_search_settings', lambda: config)
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(research_pipeline, 'TavilySearch', lambda **kwargs: TavilySearch(client=client, **kwargs))
        monkeypatch.setattr(research_pipeline, 'YuanbaoSearch', lambda **kwargs: YuanbaoSearch(client=client, **kwargs))
        assert research_pipeline.web_search_available() is True
        hits = research_pipeline.search_web('黑客松', count=3)
    if with_yuanbao:
        assert [hit.provider for hit in hits] == ['yuanbao', 'yuanbao', 'tavily']
        assert [hit.url for hit in hits] == [
            'https://common.example/one', 'https://yuanbao-only.example/one', 'https://tavily-only.example/one',
        ]
    else:
        assert [hit.provider for hit in hits] == ['tavily', 'tavily']


def test_tavily_without_a_key_does_not_request_a_provider():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    def forbidden(_request):
        raise AssertionError('未配置搜索凭据时不得发请求')

    with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
        assert TavilySearch(api_key='', client=client).search('黑客松') == []
