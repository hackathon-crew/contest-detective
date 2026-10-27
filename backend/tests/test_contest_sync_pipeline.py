import asyncio

import pytest
from pydantic import ValidationError

from contest_detective.framework.config.app import AppSettings
from contest_detective.contest.schemas import ClaimIn, ContestDraft, FieldValue, PageIn
from contest_detective.research.pipeline import (
    ContestRecord,
    ContestSyncContext,
    ContestSyncInput,
    ContestSyncPipeline,
    RetrievedPage,
    SequentialContestSync,
)
from contest_detective.research.pipeline.stages import (
    DraftVerify,
    PageExtract,
    PageRetrieve,
    StructuredCollect,
)
from contest_detective.research.search.base import SearchHit


class Stage:
    def __init__(self, name, order):
        self.name = name
        self.order = order

    async def run(self, ctx):
        self.order.append(self.name)
        if self.name == 'verify':
            ctx.records.append(ContestRecord(name='公开测试黑客松', fields={
                'city': FieldValue(value='上海', level='reposted'),
            }))
            ctx.skipped += 1


def pipeline(order, collect='both'):
    return SequentialContestSync(
        structured=Stage('structured', order),
        retrieve=Stage('retrieve', order),
        extract=Stage('extract', order),
        verify=Stage('verify', order),
        settings=AppSettings(_env_file=None, sync_collect=collect),
    )


def test_collect_setting_rejects_an_unknown_mode():
    with pytest.raises(ValidationError):
        AppSettings(_env_file=None, sync_collect='parallel')


def test_both_runs_structured_collection_before_unstructured_discovery():
    order = []
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))

    output = asyncio.run(pipeline(order).run(ctx))

    assert order == ['structured', 'retrieve', 'extract', 'verify']
    assert isinstance(pipeline([]), ContestSyncPipeline)
    assert output.records[0].name == '公开测试黑客松'
    assert output.skipped == 1


def test_structured_collection_does_not_retrieve_or_extract():
    order = []
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))

    asyncio.run(pipeline(order, 'structured').run(ctx))

    assert order == ['structured', 'verify']


def test_unstructured_discovery_does_not_collect_structured_sources():
    order = []
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))

    asyncio.run(pipeline(order, 'unstructured').run(ctx))

    assert order == ['retrieve', 'extract', 'verify']


def draft(name, mode, *, url='https://example.org/event', official=False, city='上海'):
    return ContestDraft(
        name=name,
        page=PageIn(url=url, site='example.org', title=name, is_official=official),
        claims=[
            ClaimIn(field='mode', value=mode, excerpt=f'mode: {mode}'),
            ClaimIn(field='city', value=city, excerpt=f'city: {city}'),
        ],
    )


def test_structured_collect_drops_a_different_mode_and_counts_source_failure():
    def broken(_client):
        raise RuntimeError('down')

    stage = StructuredCollect(object(), sources=[
        ('broken', broken),
        ('healthy', lambda _client: [draft('线上黑客松', 'online'), draft('线下黑客松', 'offline')]),
    ])
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',), mode='online'))

    asyncio.run(stage.run(ctx))

    assert ctx.failed == 1
    assert [item.name for item in ctx.extracted_items] == ['线上黑客松']
    assert ctx.skipped == 1


def test_retrieve_defaults_to_the_configured_yuanbao_and_tavily_search(monkeypatch):
    calls = []

    def search(query, site=None, count=10):
        calls.append((query, site, count))
        return [SearchHit(title='公开活动', url='https://example.org/one', site='example.org',
                          snippet='报名截止周五', provider='tavily')]

    monkeypatch.setattr('contest_detective.research.search_web', search)
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))

    asyncio.run(PageRetrieve(listings=[]).run(ctx))

    assert calls == [
        ('黑客松', None, 10),
        ('黑客松 报名', 'mp.weixin.qq.com', 10),
        ('黑客松 延期', 'mp.weixin.qq.com', 10),
        ('黑客松 提交截止', 'mp.weixin.qq.com', 10),
    ]
    assert ctx.retrieved_pages[0].content == '报名截止周五'
    assert ctx.retrieved_pages[0].url == 'https://example.org/one'


def test_retrieve_records_search_hits_once_per_url():
    def search(query, *, site=None, count=10):
        if site is None:
            assert query == '黑客松 中国'
        hit = SearchHit(title='公开活动', url='https://mp.weixin.qq.com/s/one', site=site or 'example.org',
                        snippet='报名截止周五', provider='tavily')
        return [hit]

    async def listing(_ctx):
        return ['https://www.huodongxing.com/event/1', 'https://mp.weixin.qq.com/s/one']

    stage = PageRetrieve(search, listings=[('huodongxing', listing)])
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',), country='中国'))

    asyncio.run(stage.run(ctx))

    assert [page.url for page in ctx.retrieved_pages] == [
        'https://mp.weixin.qq.com/s/one', 'https://www.huodongxing.com/event/1',
    ]
    assert ctx.retrieved_pages[0].content == '报名截止周五'
    assert ctx.failed == 0


def test_extract_keeps_only_claims_supported_by_the_page_text():
    async def extractor(url, text):
        assert '报名截止周五' in text
        return ContestDraft(
            name='公开测试黑客松',
            page=PageIn(url=url, site='example.org', title='待覆盖', is_official=True),
            claims=[
                ClaimIn(field='city', value='上海', excerpt='地点：上海'),
                ClaimIn(field='city', value='北京', excerpt='地点：北京'),
            ],
        )

    stage = PageExtract(extractor, fetcher=lambda _url: '')
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))
    ctx.retrieved_pages.append(RetrievedPage(
        url='https://events.example/rules', title='规则', content='地点：上海。报名截止周五',
    ))

    asyncio.run(stage.run(ctx))

    assert ctx.extracted_items[0].claims[0].value == '上海'
    assert len(ctx.extracted_items[0].claims) == 1
    assert ctx.skipped == 0


def test_verify_prefers_the_official_claim_for_one_contest():
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))
    ctx.extracted_items.extend([
        draft('公开测试黑客松', 'online', url='https://news.example/event', city='上海'),
        draft('公开测试黑客松', 'online', url='https://organizer.example/event', official=True, city='北京'),
    ])

    asyncio.run(DraftVerify().run(ctx))

    assert len(ctx.records) == 1
    assert ctx.records[0].fields['city'].value == '北京'
    assert ctx.records[0].fields['city'].level == 'official'
