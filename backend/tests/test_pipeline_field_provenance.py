import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from contest_detective.framework.config.app import AppSettings
from contest_detective.server.agent.normalization import LangChainNormalizer, NormalizedContest
from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline
from contest_detective.server.research_pipeline.pipeline.models import ContestSyncContext, ContestSyncInput
from contest_detective.server.research_pipeline.pipeline.stages import DraftVerify, PageExtract
from contest_detective.server.research_pipeline.search.base import SearchHit
from contest_detective.server.research_pipeline.structured import StructuredCandidate

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / 'fixtures'


def draft(url, *, official=False, summary=None, name='公开字段测试赛', claims=()):
    return ContestDraft(name=name, summary=summary,
        page=PageIn(url=url, site='测试来源', title=name, is_official=official),
        claims=[ClaimIn(field=field, value=value, excerpt=excerpt) for field, value, excerpt in claims])


def test_default_sync_reads_search_and_listing_detail_bodies(session_factory, monkeypatch):
    from contest_detective.server.research_pipeline import pages

    search_url = 'https://events.example/search-result'
    listing_url = 'https://www.huodongxing.com/event/123'
    bodies = {
        search_url: '搜索详情赛。奖金池价值 150w。',
        listing_url: '列表详情赛。奖金池价值 150w。',
    }
    fetched, extracted, waited = [], [], []

    def fetch(url):
        fetched.append(url)
        return bodies[url]

    def search(_query, *, site=None, count=10):
        return [] if site else [SearchHit(title='搜索详情赛', url=search_url, site='events.example',
            snippet='摘要没有奖金信息', provider='fixture')]

    async def listing(_ctx):
        return [listing_url]

    async def pause(seconds):
        waited.append(seconds)

    async def extractor(url, text):
        extracted.append((url, text))
        return draft(url, name=text.split('。')[0], claims=[
            ('prize', '奖金池价值 150w', '奖金池价值 150w'),
        ])

    monkeypatch.setattr(pages, 'fetch_page', fetch)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client, extractor=extractor,
            settings=AppSettings(_env_file=None, sync_collect='unstructured'),
            searcher=search, listings=[('fixture', listing)], sleep=pause, now=NOW)

    assert fetched == [search_url, listing_url]
    assert extracted == list(bodies.items())
    assert report.saved == 2
    assert report.failed == report.skipped == 0
    assert waited == [2]
    with session_factory() as session:
        items, total = service.query(session, ContestQuery())
        assert total == 2
        for item in items:
            prize = service.get(session, item.id).fields['prize']
            assert prize.value == '奖金池价值 150w'
            assert prize.sources[0].excerpt in bodies[prize.sources[0].url]


@pytest.mark.parametrize('pin_contest', [False, True])
def test_partial_page_refresh_keeps_only_still_supported_omitted_fields(session_factory, pin_contest):
    from contest_detective.server.research_pipeline.record import run

    url = 'https://organizer.example/rules'
    first_body = '地点：上海。奖金池价值 150w。报名费 20 元。'
    current_body = '地点：北京。奖金池价值 150w。交通信息已经更新。'

    async def initial(_url, _text):
        return draft(url, claims=[
            ('city', '上海', '地点：上海'),
            ('prize', '奖金池价值 150w', '奖金池价值 150w'),
            ('entry_fee', '20 元', '报名费 20 元'),
        ])

    async def partial(_url, _text):
        return draft(url, claims=[('city', '北京', '地点：北京')])

    contest_id = asyncio.run(run(url, extractor=initial, session_factory=session_factory,
        page_text=first_body, registration_url=url))
    kwargs = {'contest_id': contest_id} if pin_contest else {}
    saved_id = asyncio.run(run(url, extractor=partial, session_factory=session_factory,
        page_text=current_body, registration_url=url, **kwargs))

    assert saved_id == contest_id
    with session_factory() as session:
        detail = service.get(session, contest_id)
    assert detail.fields['city'].value == '北京'
    assert detail.fields['prize'].value == '奖金池价值 150w'
    assert detail.fields['entry_fee'].value is None
    assert detail.fields['prize'].sources[0].url == url
    assert detail.fields['prize'].sources[0].excerpt in current_body


def test_partial_official_refresh_does_not_cache_an_omission_as_fact_removal(session_factory, caplog):
    from contest_detective.server.research_pipeline.verification import verify_recent

    url = 'https://organizer.example/rules'
    with session_factory() as session:
        contest_id = service.save(session, draft('https://news.example/event', claims=[
            ('registration_url', url, url),
        ]))
    body = '开赛 2026-10-30。奖金池价值 150w。'
    calls = []
    caplog.set_level('INFO')

    async def fetch(_url):
        return body

    async def extractor(_url, text):
        calls.append(text)
        claims = [('start_at', '2026-10-30T00:00:00Z', '开赛 2026-10-30')]
        if len(calls) == 1:
            claims.append(('prize', '奖金池价值 150w', '奖金池价值 150w'))
        return draft(url, claims=claims)

    def refresh():
        return asyncio.run(verify_recent(session_factory=session_factory, extractor=extractor,
            fetcher=fetch, now=NOW))

    assert refresh().verified == 1
    body += '交通信息已经更新。'
    assert refresh().verified == 1
    assert refresh().unchanged == 1
    assert len(calls) == 2
    with session_factory() as session:
        prize = service.get(session, contest_id).fields['prize']
    assert prize.value == '奖金池价值 150w'
    assert prize.level == 'official'
    assert prize.sources[0].url == url
    assert 'reason=unchanged_body' in caplog.text
    assert body not in caplog.text


def test_normalized_grouped_description_keeps_its_own_source(session_factory):
    first_url = 'https://event.devpost.com/'
    second_url = 'https://events.waytoagi.com/events/fixture'
    first = draft(first_url, official=True, summary='主题：AI', claims=[
        ('start_at', '2026-10-30T00:00:00Z', 'start: 2026-10-30'),
    ])
    second = draft(second_url, summary='转载活动介绍：奖金池价值 150w。', claims=[
        ('start_at', '2026-10-30T00:00:00Z', 'date: 2026-10-30'),
    ])

    async def extract(item):
        assert item.context_url == second_url
        assert item.context == second.summary
        return NormalizedContest(name=first.name, claims=[
            ClaimIn(field='prize', value='奖金池价值 150w', excerpt='奖金池价值 150w'),
        ])

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client,
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            sources=[('devpost', lambda _: [first]), ('waytoagi', lambda _: [second])],
            normalizer=LangChainNormalizer(invoke=extract))
    assert report.failed == 0
    assert len(report.records) == 1
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
    prize = detail.fields['prize']
    assert prize.level == 'reposted'
    assert [(source.url, source.excerpt) for source in prize.sources] == [
        (second_url, '奖金池价值 150w'),
    ]
    assert {source.url for source in detail.fields['start_at'].sources} == {first_url, second_url}


def test_enriched_context_cannot_borrow_the_adapter_official_level(session_factory):
    listing_url = 'https://event.devpost.com/'
    evidence_url = 'https://news.example/actual-description'
    original = draft(listing_url, official=True, claims=[
        ('city', '上海', 'city: 上海'),
    ])
    hit = SearchHit(title='转载活动介绍', url=evidence_url, site='news.example',
        snippet='奖金池价值 150w。', provider='fixture')

    async def extract(item):
        assert item.context_url == evidence_url
        return NormalizedContest(name=original.name, claims=[
            ClaimIn(field='prize', value='奖金池价值 150w', excerpt='奖金池价值 150w'),
        ])

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client,
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            sources=[('devpost', lambda _: [original])],
            tavily=SimpleNamespace(search=lambda *_args, **_kwargs: [hit]),
            normalizer=LangChainNormalizer(invoke=extract))
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
    prize = detail.fields['prize']
    assert prize.level == 'reposted'
    assert prize.sources[0].url == evidence_url
    assert detail.fields['city'].sources[0].url == listing_url
    assert detail.fields['city'].level == 'official'


def test_same_url_enrichment_preserves_known_page_identity_and_publication_time(session_factory):
    url = 'https://events.waytoagi.com/events/hosted-fixture'
    original = draft(url, official=True, claims=[('city', '上海', 'city: 上海')])
    original.page = original.page.model_copy(update={
        'published_at': datetime(2026, 10, 1, tzinfo=timezone.utc),
    })
    hit = SearchHit(title='搜索结果标题', url=url, site='events.waytoagi.com',
        snippet='奖金池价值 150w。', provider='fixture')

    async def extract(_item):
        return NormalizedContest(name=original.name, claims=[
            ClaimIn(field='prize', value='奖金池价值 150w', excerpt='奖金池价值 150w'),
        ])

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client,
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            sources=[('waytoagi', lambda _: [original])],
            tavily=SimpleNamespace(search=lambda *_args, **_kwargs: [hit]),
            normalizer=LangChainNormalizer(invoke=extract))
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
    for field in ('city', 'prize'):
        assert report.records[0].fields[field].level == detail.fields[field].level == 'official'
        source, = detail.fields[field].sources
        assert source.url == url
        assert source.site == original.page.site
        assert source.title == original.page.title
        assert source.published_at == original.page.published_at


def test_fresh_secondary_source_claim_replaces_its_own_old_claim(session_factory):
    first_url = 'https://first.example/event'
    second_url = 'https://second.example/event'
    first = draft(first_url, claims=[('start_at', '2026-10-30T00:00:00Z', '开赛 2026-10-30')])
    original = draft(second_url, claims=[
        ('start_at', '2026-10-30T00:00:00Z', '开赛 2026-10-30'),
        ('prize', '旧奖金池', '旧奖金池'),
    ])
    updated = original.model_copy(update={'claims': [original.claims[0],
        ClaimIn(field='prize', value='新奖金池', excerpt='新奖金池'),
    ]})
    with session_factory() as session:
        contest_id = service.save(session, first)
        service.save(session, original, contest_id=contest_id)

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client,
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            sources=[('hackertrip', lambda _: [first]), ('waytoagi', lambda _: [updated])])
    assert report.records[0].contest_id == contest_id
    with session_factory() as session:
        prize = service.get(session, contest_id).fields['prize']
    assert prize.value == '新奖金池'
    assert [(source.url, source.value) for source in prize.sources] == [(second_url, '新奖金池')]


def test_combined_verification_keeps_unstructured_official_evidence():
    original = draft('https://news.example/event', claims=[('city', '上海', '城市：上海')])
    official = draft('https://organizer.example/event', official=True,
        claims=[('city', '北京', '城市：北京')])
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('字段测试',)))
    ctx.structured_candidates = [StructuredCandidate('hackertrip', original)]
    ctx.extracted_items = [original, official]

    asyncio.run(DraftVerify().run(ctx))

    city = ctx.records[0].fields['city']
    assert city.value == '北京'
    assert city.level == 'official'
    assert {source.url for source in city.sources} == {original.page.url, official.page.url}


def test_whitespace_excerpt_is_not_evidence_in_either_extraction_path():
    from contest_detective.server.research_pipeline.normalization import supported_claims
    from contest_detective.server.research_pipeline.pipeline.models import RetrievedPage

    unsupported = ClaimIn(field='entry_fee', value='免费', excerpt=' \n\t ')
    assert supported_claims('原文没有费用信息', [unsupported]) == []

    async def extractor(url, _text):
        return draft(url).model_copy(update={'claims': [unsupported]})

    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('字段测试',)))
    ctx.retrieved_pages = [RetrievedPage(url='https://news.example/event', raw_content='原文没有费用信息')]
    asyncio.run(PageExtract(extractor).run(ctx))
    assert ctx.extracted_items == []
    assert ctx.skipped == 1


def test_partial_recording_does_not_attribute_other_page_evidence_to_the_current_page(session_factory):
    from contest_detective.server.research_pipeline.record import run

    old_url = 'https://news.example/old'
    current_url = 'https://organizer.example/current'
    with session_factory() as session:
        contest_id = service.save(session, draft(old_url, claims=[
            ('prize', '奖金池价值 150w', '奖金池价值 150w'),
        ]))

    async def extractor(url, _text):
        return draft(url, claims=[('city', '上海', '地点：上海')])

    asyncio.run(run(current_url, extractor=extractor, session_factory=session_factory,
        page_text='地点：上海。奖金池价值 150w。', registration_url=current_url, contest_id=contest_id))
    with session_factory() as session:
        prize = service.get(session, contest_id).fields['prize']
    assert prize.level == 'reposted'
    assert [source.url for source in prize.sources] == [old_url]


@pytest.mark.parametrize('outcome', ['disabled', 'failed', 'no_new_claims'])
def test_sync_reports_normalization_outcome_without_logging_page_text(session_factory, caplog, outcome):
    caplog.set_level('INFO')
    marker = 'fixture-content-must-not-appear-in-logs'
    original = draft('https://news.example/event', summary=marker,
        claims=[('city', '上海', 'city: 上海')])

    async def invoke(_item):
        if outcome == 'failed':
            raise RuntimeError(marker)
        return NormalizedContest(name=original.name, claims=[])

    normalizer = None if outcome == 'disabled' else LangChainNormalizer(invoke=invoke)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        report = run_pipeline(session_factory, client=client,
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            sources=[('waytoagi', lambda _: [original])], normalizer=normalizer)

    assert report.saved == 1
    assert report.failed == (1 if outcome == 'failed' else 0)
    assert marker not in caplog.text
    if outcome == 'disabled':
        assert 'reason=not_configured candidates=1' in caplog.text
    elif outcome == 'failed':
        assert 'Structured normalization failed error_type=RuntimeError' in caplog.text
    else:
        assert 'Normalization claims accepted=0 rejected_evidence=0 skipped_existing=0' in caplog.text
        assert 'Structured normalization completed source=waytoagi added_claims=0' in caplog.text


@pytest.mark.parametrize(('enabled', 'reason'), [(False, 'llm_disabled'), (True, 'missing_api_key')])
def test_bootstrap_logs_why_normalization_is_unavailable(monkeypatch, caplog, enabled, reason):
    from contest_detective.web.bootstrap import source_sync

    caplog.set_level('INFO')
    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: SimpleNamespace(enabled=enabled, api_key=None))

    assert source_sync.configured_normalizer() is None
    assert f'Structured normalizer unavailable reason={reason}' in caplog.text


def test_clawhunt_description_fields_reach_detail_api_without_inventing_unknowns(session_factory, client, caplog):
    from contest_detective.server.research_pipeline.sources.waytoagi import fetch

    event_id = 'e_68f515d808'
    listing = json.loads((FIXTURES / 'waytoagi.json').read_text())
    listing['items'] = [item for item in listing['items'] if item['id'] == event_id]
    detail = json.loads((FIXTURES / 'waytoagi_details.json').read_text())[event_id]
    excerpt_by_field = {
        'prize': '价值 150w 的奖金池。',
        'eligibility': '上海站将聚集开发者、产品团队、企业与产业伙伴',
        'entry_requirements': '现场可运行的 Demo 是交付的底线。',
    }
    caplog.set_level('INFO')

    def handle(request):
        assert request.url.host == 'events.waytoagi.com'
        return httpx.Response(200, json=listing if request.url.path == '/api/events' else detail)

    async def extract(item):
        assert item.context == detail['event']['description']
        return NormalizedContest(name=detail['event']['title'], claims=[
            ClaimIn(field=field, value=excerpt, excerpt=excerpt) for field, excerpt in excerpt_by_field.items()
        ] + [ClaimIn(field='entry_fee', value='免费', excerpt='原文未提供的免费承诺')])

    kwargs = {'sources': [('waytoagi', fetch)],
              'settings': AppSettings(_env_file=None, sync_collect='structured')}
    with httpx.Client(transport=httpx.MockTransport(handle)) as source_client:
        original = run_pipeline(session_factory, client=source_client, **kwargs)
        normalized = run_pipeline(session_factory, client=source_client,
            normalizer=LangChainNormalizer(invoke=extract), **kwargs)
        repeated = run_pipeline(session_factory, client=source_client, **kwargs)
    contest_id = original.records[0].contest_id
    assert normalized.records[0].contest_id == repeated.records[0].contest_id == contest_id
    assert original.failed == normalized.failed == repeated.failed == 0
    assert 'reason=not_configured candidates=1' in caplog.text
    assert 'Normalization claims accepted=3 rejected_evidence=1 skipped_existing=0' in caplog.text
    assert 'Structured normalization completed source=waytoagi added_claims=3' in caplog.text
    assert detail['event']['description'] not in caplog.text

    response = client.get(f'/contests/{contest_id}')
    assert response.status_code == 200
    assert response.json()['code'] == 200
    fields = response.json()['data']['fields']
    for field, excerpt in excerpt_by_field.items():
        assert fields[field]['value'] == excerpt
        assert fields[field]['level'] == 'reposted'
        assert fields[field]['sources'][0]['url'] == f'https://events.waytoagi.com/events/{event_id}'
        assert fields[field]['sources'][0]['excerpt'] == excerpt
    for field in ('organizer', 'team_size', 'entry_fee', 'judging_criteria', 'past_statistics',
                  'registration_deadline', 'submission_deadline'):
        assert fields[field]['value'] is None
        assert fields[field]['sources'] == []
    assert fields['deadline_unspecified']['value'] == '2026-10-30T15:59:00Z'
    assert fields['start_at']['precision'] == fields['end_at']['precision'] == 'day'
