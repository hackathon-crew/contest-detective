import pytest


class FakeTavilyClient:
    def __init__(self, handler):
        self.handler = handler
        self.calls: list[dict] = []

    def search(self, **kwargs):
        self.calls.append(kwargs)
        return self.handler(kwargs)


def test_tavily_maps_basic_search_and_site_restrictions_without_answer_generation():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    def handler(kwargs):
        assert kwargs == {
            'query': '黑客松',
            'search_depth': 'basic',
            'max_results': 2,
            'include_answer': False,
            'include_raw_content': False,
            'auto_parameters': False,
            'timeout': 10,
            'include_domains': ['mp.weixin.qq.com'],
        }
        return {'results': [
            {'title': '公开活动', 'url': 'https://mp.weixin.qq.com/s/one', 'content': '报名截止周五',
             'published_date': '2026-10-23'},
            {'title': '规则', 'url': 'https://mp.weixin.qq.com/s/two', 'content': '赛程原文'},
            {'title': '坏链接', 'url': 'javascript:alert(1)', 'content': '不进入结果'},
        ]}

    client = FakeTavilyClient(handler)
    hits = TavilySearch(api_key='test-key', client=client).search('黑客松', site='mp.weixin.qq.com', count=2)
    assert [item.url for item in hits] == ['https://mp.weixin.qq.com/s/one', 'https://mp.weixin.qq.com/s/two']
    assert hits[0].provider == 'tavily'
    assert hits[0].date == '2026-10-23'
    assert hits[0].snippet == '报名截止周五'


def test_tavily_limits_results_to_twenty_and_maps_exclusions():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    def handler(kwargs):
        assert kwargs['max_results'] == 20
        assert kwargs['exclude_domains'] == ['example.org', 'example.net']
        return {'results': [
            {'url': f'https://source.example/{index}', 'content': '原文'} for index in range(30)
        ]}

    hits = TavilySearch(api_key='test-key', client=FakeTavilyClient(handler)).search(
        '黑客松', site='exclude:example.org|example.net', count=50,
    )
    assert len(hits) == 20


@pytest.mark.parametrize('count', [0, 51])
def test_tavily_rejects_invalid_result_counts(count):
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    with pytest.raises(ValueError):
        TavilySearch(api_key='test-key').search('黑客松', count=count)


def test_tavily_sanitizes_error_payloads():
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch

    client = FakeTavilyClient(lambda _: {'detail': {'error': 'private provider response'}})
    with pytest.raises(ValueError, match='搜索服务暂时不可用') as caught:
        TavilySearch(api_key='test-key', client=client).search('黑客松')
    assert 'private' not in str(caught.value)


@pytest.mark.parametrize('with_yuanbao', [False, True])
def test_configured_search_uses_tavily_and_preserves_yuanbao_priority(monkeypatch, with_yuanbao):
    from types import SimpleNamespace

    from contest_detective.framework.config.search import SearchSettings
    from contest_detective.server import research_pipeline
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    tavily = FakeTavilyClient(lambda _: {'results': [
        {'url': 'https://common.example/one', 'content': '共同来源'},
        {'url': 'https://tavily-only.example/one', 'content': '补充来源'},
    ]})

    class FakeYuanbao:
        def SearchPro(self, _request):
            return SimpleNamespace(Pages=[
                '{"url": "https://common.example/one"}',
                '{"url": "https://yuanbao-only.example/one"}',
            ])

    config = SearchSettings(
        yuanbao_secret_id='id' if with_yuanbao else None,
        yuanbao_secret_key='key' if with_yuanbao else None,
        tavily_api_key='test-key',
    )
    monkeypatch.setattr(research_pipeline, 'get_search_settings', lambda: config)
    monkeypatch.setattr(
        research_pipeline,
        'TavilySearch',
        lambda **kwargs: TavilySearch(client=tavily, **kwargs),
    )
    monkeypatch.setattr(
        research_pipeline,
        'YuanbaoSearch',
        lambda **kwargs: YuanbaoSearch(client=FakeYuanbao(), **kwargs),
    )
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

    class ForbiddenClient:
        def search(self, **_kwargs):
            raise AssertionError('未配置搜索凭据时不得发请求')

    assert TavilySearch(api_key='', client=ForbiddenClient()).search('黑客松') == []
