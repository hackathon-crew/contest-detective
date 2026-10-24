import asyncio
from pathlib import Path

import httpx

from contest_detective.server.contest.schemas import ContestDraft, ContestQuery
from contest_detective.server.contest.service import get, query


def test_registration_search_extracts_bounded_same_site_urls():
    from contest_detective.server.research_pipeline.sources.huodongxing import discover_urls

    snapshot = (Path(__file__).parent / 'fixtures/huodongxing.html').read_text(encoding='utf-8')
    urls = discover_urls(snapshot)
    assert len(urls) == 8
    assert urls[0] == 'https://www.huodongxing.com/event/6883666147100'
    assert all('?' not in url for url in urls)
    assert discover_urls('''<a href="/event/123?x=1">a</a><a href="/event/123">a</a>
        <a href="https://www.huodongxing.com.evil.example/event/4">bad</a>
        <a href="/event/not-an-id">bad</a><a href="https://[invalid/event/5">bad</a>''') == ['https://www.huodongxing.com/event/123']


def test_registration_discovery_throttles_requests_and_saves_supported_pages(session_factory, monkeypatch):
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pages import fetch_page
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline

    snapshot = (Path(__file__).parent / 'fixtures/huodongxing.html').read_text(encoding='utf-8')
    waits = []

    async def pause(seconds):
        waits.append(seconds)

    async def extractor(url, text):
        return ContestDraft(name='报名活动 '+url.rsplit('/', 1)[-1],
            page={'url': url, 'site': '来源', 'title': '来源', 'is_official': False},
            claims=[{'field': 'city', 'value': '上海', 'excerpt': '上海'}])

    def handle(request):
        if request.url.path == '/search':
            assert request.url.params['qs'] == '黑客松'
            return httpx.Response(200, text=snapshot)
        if request.url.path.endswith('9883938191800'):
            return httpx.Response(503)
        return httpx.Response(200, text='公开报名活动，地点上海', headers={'content-type': 'text/plain'})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        fetcher = lambda url: fetch_page(url, client=client,
            resolver=lambda *_args, **_kwargs: [(None, None, None, None, ('8.8.8.8', 443))])
        report = run_pipeline(session_factory, client=client, extractor=extractor, fetcher=fetcher, sleep=pause,
                              settings=AppSettings(_env_file=None, sync_collect='unstructured'), sources=[],
                              searcher=lambda *_args, **_kwargs: [])
    assert report.saved == 7
    assert report.failed == 1
    assert waits == [2] * 8
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 7
        assert all(get(session, item.id).fields['city'].level == 'official' for item in items)


def test_announcement_search_uses_fixed_site_deduplication_and_the_real_record_pipeline(session_factory, monkeypatch):
    import json
    from types import SimpleNamespace

    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.research_pipeline.pages import fetch_page
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline
    from contest_detective.server.research_pipeline.search.yuanbao import YuanbaoSearch

    queries = []

    async def extractor(url, text):
        return ContestDraft(name='公众号活动 '+url.rsplit('/', 1)[-1],
            page={'url': url, 'site': '来源', 'title': '来源', 'is_official': True},
            claims=[{'field': 'city', 'value': '上海', 'excerpt': '上海'}])

    def handle(request):
        assert request.url.path in {'/s/one', '/s/two'}
        return httpx.Response(200, text='本活动在上海举行', headers={'content-type': 'text/plain'})

    class FakeYuanbao:
        def SearchPro(self, request):
            if request.Site != 'mp.weixin.qq.com':
                return SimpleNamespace(Pages=[])
            assert request.Cnt == 10
            queries.append(request.Query)
            return SimpleNamespace(Pages=[json.dumps({'url': url}) for url in [
                'https://mp.weixin.qq.com/s/one', 'https://mp.weixin.qq.com/s/one#tracking',
                'https://mp.weixin.qq.com/s/two', 'https://mp.weixin.qq.com.evil.example/s/no',
            ]])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        searcher = YuanbaoSearch(secret_id='id', secret_key='key', client=FakeYuanbao()).search
        fetcher = lambda url: fetch_page(url, client=client,
            resolver=lambda *_args, **_kwargs: [(None, None, None, None, ('8.8.8.8', 443))])
        report = run_pipeline(session_factory, client=client, extractor=extractor, fetcher=fetcher, searcher=searcher,
                              settings=AppSettings(_env_file=None, sync_collect='unstructured'), sources=[],
                              listings=[])
    assert set(queries) == {'黑客松 报名', '黑客松 延期', '黑客松 提交截止'}
    assert report.saved == 2
    assert report.failed == 0
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 2
        # 搜索命中公众号不等于核实了主办方身份。
        assert all(get(session, item.id).fields['city'].level == 'reposted' for item in items)
