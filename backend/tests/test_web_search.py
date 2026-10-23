import json

import httpx
import pytest


def test_yuanbao_decodes_string_pages_and_rounds_the_requested_count():
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    def handle(request):
        assert str(request.url) == 'https://api.wsa.cloud.tencent.com/SearchPro'
        assert request.headers['Authorization'] == 'Bearer test-key'
        assert json.loads(request.content) == {'Query': '黑客松', 'Cnt': 10, 'Site': 'example.org'}
        return httpx.Response(200, json={'Response': {'RequestId': 'fixture', 'Pages': [
            json.dumps({'title': '公开赛事', 'url': 'https://example.org/one', 'date': '2026-10-23',
                        'site': 'example.org', 'score': 0.9, 'passage': '赛事摘要', 'content': '公开正文'}),
            json.dumps({'title': '另一个赛事', 'url': 'https://example.org/two', 'date': '',
                        'site': 'example.org', 'score': 0.7, 'passage': '', 'content': '正文摘要'}),
        ]}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        hits = YuanbaoSearch(api_key='test-key', client=client).search('黑客松', site='example.org', count=2)

    assert len(hits) == 2
    assert hits[0].model_dump() == {'title': '公开赛事', 'url': 'https://example.org/one',
                                    'date': '2026-10-23', 'site': 'example.org',
                                    'snippet': '赛事摘要', 'provider': 'yuanbao'}
    assert hits[1].snippet == '正文摘要'


@pytest.mark.parametrize('count', [0, 51])
def test_yuanbao_rejects_invalid_counts_before_any_request(count):
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    with pytest.raises(ValueError):
        YuanbaoSearch(api_key='test-key').search('黑客松', count=count)


def test_yuanbao_rejects_provider_errors_without_exposing_the_payload():
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={
        'Response': {'Error': {'Code': 'UnauthorizedOperation', 'Message': 'sensitive provider details'}},
    }))) as client:
        with pytest.raises(ValueError, match='搜索服务暂不可用') as error:
            YuanbaoSearch(api_key='test-key', client=client).search('黑客松')
    assert 'sensitive' not in str(error.value)


def test_mixed_search_interleaves_providers_and_deduplicates_urls():
    from contest_detective.server.research_pipeline.search.base import SearchHit
    from contest_detective.server.research_pipeline.search.mixed import MixedSearch

    class Provider:
        def __init__(self, name, urls):
            self.name, self.urls = name, urls

        def search(self, query, *, site=None, count=10):
            return [SearchHit(title=url, url=url, site='example.org', date=None,
                              snippet='', provider=self.name) for url in self.urls]

    primary = Provider('yuanbao', ['https://example.org/one', 'https://example.org/two'])
    other = Provider('other', ['https://example.org/one', 'https://example.org/three'])
    hits = MixedSearch(primary, [other]).search('黑客松', count=3)

    assert [hit.url for hit in hits] == [
        'https://example.org/one', 'https://example.org/two', 'https://example.org/three',
    ]
    assert hits[0].provider == 'yuanbao'


def test_no_key_disables_search_without_network(monkeypatch):
    from contest_detective.server import research_pipeline
    from contest_detective.framework.config.search import SearchSettings

    monkeypatch.setattr(research_pipeline, 'get_search_settings', lambda: SearchSettings(yuanbao_api_key=None))
    assert research_pipeline.web_search_available() is False
    assert research_pipeline.search_web('黑客松') == []
