import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from contest_detective.server.contest.content import CoverageObservation
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.detail import BoundedPublicDetailFetcher, detail_targets, document_for
from contest_detective.server.research_pipeline.detail_contracts import DetailFetchResult, DetailTarget
from contest_detective.server.research_pipeline.normalization import merge_normalized
from contest_detective.server.research_pipeline.pipeline.models import ContestSyncContext, ContestSyncInput
from contest_detective.server.research_pipeline.pipeline.stages import DraftVerify, StructuredDeduplicate, StructuredDetail, StructuredNormalize
from contest_detective.server.research_pipeline.search.base import SearchHit
from contest_detective.server.research_pipeline.structured import StructuredCandidate, StructuredDescriptionEnrich

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)
DESCRIPTION = 'This hackathon invites student developers to build practical projects together.'


def draft(url='https://events.waytoagi.com/events/fixture', *, summary=DESCRIPTION, claims=None):
    return ContestDraft(name='Fixture Hackathon', summary=summary,
        page=PageIn(url=url, site='Fixture source', title='Fixture Hackathon', is_official=False),
        claims=claims if claims is not None else [ClaimIn(field='city', value='Shanghai', excerpt='city: Shanghai')])


def context(*candidates):
    return ContestSyncContext(request=ContestSyncInput(keywords=('hackathon',)),
        structured_candidates=list(candidates), extracted_items=[candidate.draft for candidate in candidates])


async def pause(_seconds):
    pass


def public_dns(*_args, **_kwargs):
    return [(None, None, None, None, ('8.8.8.8', 443))]


def target(url='https://host.devpost.com/'):
    return DetailTarget(page=PageIn(url=url, site='Devpost', title='Fixture Hackathon',
        is_official=True), contest_name='Fixture Hackathon')


def test_nonempty_adapter_description_does_not_gate_public_details_without_a_model():
    candidate = StructuredCandidate('waytoagi', draft())
    assert candidate.has_description
    visited = []

    async def fetch(item):
        visited.append(item.page.url)
        document = document_for(item.page, DESCRIPTION + ' The competition welcomes open-source projects.', now=NOW)
        return DetailFetchResult(document=document, coverage=CoverageObservation(state='found', urls=[item.page.url]))

    ctx = context(candidate)
    asyncio.run(StructuredDetail(fetch).run(ctx))
    asyncio.run(DraftVerify().run(ctx))
    assert visited == [candidate.draft.page.url]
    assert {document.kind for document in candidate.draft.documents} == {'structured', 'page'}
    assert candidate.draft.introduction is not None
    assert ctx.records[0].introduction is not None
    assert ctx.records[0].fields['city'].value == 'Shanghai'
    assert ctx.stage_counts['detail'] == {'attempted': 1, 'fetched': 1}


def test_real_body_only_draft_survives_verification_but_theme_stub_is_not_an_intro():
    candidate = StructuredCandidate('devpost', draft('https://host.devpost.com/',
        summary='AI\n\n提交区间：Nov 1 - 3, 2026', claims=[]))
    assert candidate.draft.documents == []
    assert candidate.draft.introduction is None

    async def fetch(item):
        document = document_for(item.page, DESCRIPTION, now=NOW)
        return DetailFetchResult(document=document, coverage=CoverageObservation(state='found', urls=[document.url]))

    ctx = context(candidate)
    asyncio.run(StructuredDetail(fetch).run(ctx))
    asyncio.run(DraftVerify().run(ctx))
    assert len(ctx.records) == 1
    assert len(ctx.records[0].documents) == 2
    assert ctx.records[0].introduction.text == DESCRIPTION


def test_detail_failure_and_run_bound_preserve_healthy_adapter_data():
    first = StructuredCandidate('devpost', draft('https://first.devpost.com/', summary=None))
    second = StructuredCandidate('devpost', draft('https://second.devpost.com/', summary=None))

    async def broken(_target):
        raise RuntimeError('fixture error')

    ctx = context(first, second)
    asyncio.run(StructuredDetail(broken, limit=1).run(ctx))
    asyncio.run(DraftVerify().run(ctx))
    assert ctx.failed == 1
    assert ctx.stage_counts['detail'] == {'attempted': 1, 'failed': 1, 'bounded': 3}
    assert all(record.fields['city'].value == 'Shanghai' for record in ctx.records)
    assert first.draft.coverage.sources[first.draft.page.url].state == 'fetch_failed'
    assert second.draft.coverage.sources[second.draft.page.url].reason == 'detail_run_limit'


def test_one_normalizer_call_maps_each_excerpt_to_its_document_and_keeps_conflicts():
    candidate = StructuredCandidate('devpost', draft('https://fixture.devpost.com/', summary='AI'))
    candidate.draft.page.is_official = True
    called = []

    async def fetch(item):
        body = DESCRIPTION + (' City: Tokyo.' if item.purpose == 'rules' else ' City: Beijing.')
        document = document_for(item.page, body, now=NOW)
        return DetailFetchResult(document=document, coverage=CoverageObservation(state='found', urls=[document.url]))

    async def normalize(item):
        called.append(item)
        assert item.allow_conflicts is True
        return merge_normalized(item, SimpleNamespace(claims=[
            ClaimIn(field='city', value='Beijing', excerpt='City: Beijing.'),
            ClaimIn(field='city', value='Tokyo', excerpt='City: Tokyo.'),
            ClaimIn(field='entry_fee', value='Free', excerpt='Unsupported free entry'),
        ], cover_url=None, summary=None))

    ctx = context(candidate)
    asyncio.run(StructuredDeduplicate().run(ctx))
    asyncio.run(StructuredDetail(fetch).run(ctx))
    asyncio.run(StructuredNormalize(normalize).run(ctx))
    asyncio.run(DraftVerify().run(ctx))
    assert len(called) == 1
    sources = ctx.records[0].fields['city'].sources
    assert {(source.value, source.url) for source in sources} == {
        ('Shanghai', 'https://fixture.devpost.com/'), ('Beijing', 'https://fixture.devpost.com/'),
        ('Tokyo', 'https://fixture.devpost.com/rules'),
    }
    assert ctx.records[0].fields['city'].level == 'conflict'
    assert 'entry_fee' not in ctx.records[0].fields


def test_search_enrichment_is_partial_snippet_evidence_not_a_body_or_intro():
    candidate = StructuredCandidate('devpost', draft('https://fixture.devpost.com/', summary=None))
    hit = SearchHit(title='News', url='https://news.example/event', site='News',
        snippet=DESCRIPTION, provider='fixture')
    asyncio.run(StructuredDescriptionEnrich(SimpleNamespace(search=lambda *_a, **_k: [hit])).run([candidate]))
    document, = candidate.draft.documents
    assert document.kind == 'search_snippet'
    assert document.completeness == 'partial'
    assert document.fetch_method == 'cached_web_excerpt'
    assert document.is_official is False
    assert candidate.draft.introduction is None


def test_targets_are_known_pages_and_devpost_rules_bounded_to_three():
    candidate = StructuredCandidate('devpost', draft('https://fixture.devpost.com/', summary=None, claims=[
        ClaimIn(field='registration_url', value='https://organizer.example/register', excerpt='registration'),
    ]))
    assert [item.page.url for item in detail_targets(candidate)] == [
        'https://fixture.devpost.com/', 'https://organizer.example/register', 'https://fixture.devpost.com/rules',
    ]


def test_public_fetcher_retries_transient_failure_and_preserves_real_document_metadata():
    requests, attempts = [], []

    def handle(request):
        requests.append(request.url.path)
        if request.url.path == '/robots.txt':
            return httpx.Response(200, text='User-agent: *\nAllow: /', headers={'content-type': 'text/plain'})
        attempts.append(1)
        if len(attempts) == 1:
            return httpx.Response(503)
        return httpx.Response(200, text=DESCRIPTION, headers={'content-type': 'text/plain'})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        result = asyncio.run(BoundedPublicDetailFetcher(client=client, resolver=public_dns,
            sleep=pause, now=NOW)(target()))
    assert requests == ['/robots.txt', '/', '/']
    assert result.document.body == DESCRIPTION
    assert result.document.fetch_method == 'http'
    assert result.document.completeness == 'full'
    assert result.document.publication == 'excerpt_only'


@pytest.mark.parametrize('redirect', [False, True])
def test_robots_denial_is_not_requested_or_retried_even_after_redirect(redirect):
    requests = []

    def handle(request):
        requests.append(request.url.path)
        if request.url.path == '/robots.txt':
            return httpx.Response(200, text='User-agent: *\nDisallow: /private', headers={'content-type': 'text/plain'})
        if request.url.path == '/':
            return httpx.Response(302, headers={'location': '/private'})
        raise AssertionError('Denied path must not be requested')

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        result = asyncio.run(BoundedPublicDetailFetcher(client=client, resolver=public_dns,
            sleep=pause)(target('https://host.devpost.com/' if redirect else 'https://host.devpost.com/private')))
    assert result.document is None
    assert result.coverage.reason == 'robots_denied'
    assert requests == (['/robots.txt', '/'] if redirect else ['/robots.txt'])


def test_existing_api_routes_are_not_reached_by_the_new_public_fetcher():
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail('Denied route was requested'))) as client:
        result = asyncio.run(BoundedPublicDetailFetcher(client=client, resolver=public_dns,
            sleep=pause)(target('https://events.waytoagi.com/api/events')))
    assert result.coverage.state == 'fetch_failed'
    assert result.coverage.reason == 'denied_api_route'


def test_detail_fetcher_assembly_does_not_read_model_or_search_settings(monkeypatch):
    from contest_detective.web.bootstrap import source_sync

    monkeypatch.setattr(source_sync, 'get_llm_settings', lambda: pytest.fail('model configuration accessed'))
    monkeypatch.setattr(source_sync, 'get_search_settings', lambda: pytest.fail('search configuration accessed'))
    assert isinstance(source_sync.configured_detail_fetcher(), BoundedPublicDetailFetcher)


def test_supported_same_page_contradiction_survives_a_partial_refresh(session_factory):
    from contest_detective.server.contest import service
    from contest_detective.server.research_pipeline.record import run

    url = 'https://organizer.example/rules'
    initial = 'City: Shanghai. City: Beijing.'

    async def first(_url, _text):
        return draft(url, claims=[ClaimIn(field='city', value='Shanghai', excerpt='City: Shanghai.')])

    async def partial(_url, _text):
        return draft(url, claims=[ClaimIn(field='city', value='Beijing', excerpt='City: Beijing.')])

    contest_id = asyncio.run(run(url, extractor=first, page_text=initial,
        registration_url=url, session_factory=session_factory))
    asyncio.run(run(url, extractor=partial, page_text=initial, registration_url=url,
        contest_id=contest_id, session_factory=session_factory))
    with session_factory() as session:
        city = service.get(session, contest_id).fields['city']
    assert {source.value for source in city.sources} == {'Shanghai', 'Beijing'}
    assert city.level == 'conflict'


def test_same_hash_with_new_extractor_version_is_reprocessed_after_success(session_factory):
    from contest_detective.server.contest import service
    from contest_detective.server.research_pipeline.verification import verify_recent

    url = 'https://organizer.example/rules'
    with session_factory() as session:
        service.save(session, draft('https://news.example/event', claims=[ClaimIn(field='registration_url', value=url, excerpt=url)]))
    calls = []

    async def fetch(_url):
        return 'City: Beijing.'

    async def extractor(_url, _body):
        calls.append(1)
        return draft(url, claims=[ClaimIn(field='city', value='Beijing', excerpt='City: Beijing.')])

    def verify(version):
        return asyncio.run(verify_recent(session_factory=session_factory, extractor=extractor,
            fetcher=fetch, now=NOW, extractor_version=version))

    assert verify('version-one').verified == 1
    assert verify('version-one').unchanged == 1
    assert verify('version-two').verified == 1
    assert verify('version-two').unchanged == 1
    assert len(calls) == 2


def test_failed_persistence_never_marks_hash_or_extractor_version_as_processed(session_factory):
    from sqlalchemy import select
    from contest_detective.server.contest import service
    from contest_detective.server.contest.models import ContestPage
    from contest_detective.server.research_pipeline.verification import verify_recent

    url = 'https://organizer.example/rules'
    with session_factory() as session:
        service.save(session, draft(url, claims=[ClaimIn(field='registration_url', value=url, excerpt=url)]))
    calls = []

    async def fetch(_url):
        return 'City: Beijing.'

    async def runner(_url, **_kwargs):
        calls.append(1)
        raise RuntimeError('persist failed')

    for _ in range(2):
        report = asyncio.run(verify_recent(session_factory=session_factory, extractor=None,
            fetcher=fetch, runner=runner, now=NOW, extractor_version='changed-version'))
        assert report.failed == 1
    with session_factory() as session:
        page = session.scalar(select(ContestPage).where(ContestPage.url == url))
        assert page.content_hash is None
        assert page.extractor_version is None
    assert len(calls) == 2


def test_robots_wildcard_denial_and_encoded_api_routes_are_not_requested():
    requests = []

    def handle(request):
        requests.append(request.url.path)
        return httpx.Response(200, text='User-agent: *\nDisallow: /private*', headers={'content-type': 'text/plain'})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        fetcher = BoundedPublicDetailFetcher(client=client, resolver=public_dns, sleep=pause)
        denied = asyncio.run(fetcher(target('https://host.devpost.com/private-stuff')))
        encoded = asyncio.run(fetcher(target('https://events.waytoagi.com/%61pi/events')))
    assert denied.coverage.reason == 'robots_denied'
    assert encoded.coverage.reason == 'denied_api_route'
    assert requests == ['/robots.txt']


def test_unknown_robots_failure_is_not_treated_as_permission_to_fetch():
    requests = []

    def handle(request):
        requests.append(request.url.path)
        return httpx.Response(503)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        result = asyncio.run(BoundedPublicDetailFetcher(client=client, resolver=public_dns,
            sleep=pause)(target()))
    assert result.document is None
    assert result.coverage.state == 'fetch_failed'
    assert requests == ['/robots.txt', '/robots.txt']


def test_theme_absence_and_explicit_empty_are_not_conflated_during_grouping():
    absent = StructuredCandidate('fixture', draft(summary=None))
    cleared = StructuredCandidate('devpost', draft('https://fixture.devpost.com/', summary=None))
    cleared.draft.themes = []
    cleared.theme_pages[cleared.draft.page.url] = []
    first, second = context(absent), context(cleared)
    for ctx in (first, second):
        asyncio.run(StructuredDeduplicate().run(ctx))
        asyncio.run(DraftVerify().run(ctx))
    assert first.records[0].themes is None
    assert second.records[0].themes == []


def test_grouped_aggregator_pages_do_not_crowd_out_known_registration_and_rules():
    first = StructuredCandidate('hackertrip', draft('https://hackertrip.space/hackathon/one'))
    second = StructuredCandidate('waytoagi', draft('https://events.waytoagi.com/events/one'))
    official = StructuredCandidate('devpost', draft('https://fixture.devpost.com/', summary=None, claims=[
        ClaimIn(field='registration_url', value='https://fixture.devpost.com/', excerpt='registration'),
    ]))
    first.group = [first, second, official]
    first.draft = first.draft.model_copy(update={'claims': [*first.draft.claims, *official.draft.claims]})
    urls = [target.page.url for target in detail_targets(first)]
    assert 'https://fixture.devpost.com/' in urls
    assert 'https://fixture.devpost.com/rules' in urls
    assert len(urls) == 3


def test_text_only_port_rejects_cross_host_redirect_instead_of_borrowing_official_identity():
    from contest_detective.server.research_pipeline.detail import safe_page_reader

    async def redirected(_target):
        page = PageIn(url='https://news.example/mirror', site='News', title='Mirror', is_official=False)
        return DetailFetchResult(document=document_for(page, DESCRIPTION),
            coverage=CoverageObservation(state='found', urls=[page.url]))

    with pytest.raises(PermissionError, match='redirect_source_requires_document_pipeline'):
        asyncio.run(safe_page_reader(redirected)('https://fixture.devpost.com/'))


@pytest.mark.parametrize('include_complete_page', [False, True])
def test_omitted_fields_require_complete_page_evidence_before_claiming_checked_absence(include_complete_page):
    candidate = StructuredCandidate('waytoagi', draft())
    snippet_page = PageIn(url='https://news.example/snippet', site='News', title='Search result', is_official=False)
    documents = [*candidate.draft.documents, document_for(snippet_page, DESCRIPTION,
        kind='search_snippet', fetch_method='cached_web_excerpt', completeness='partial')]
    complete_url = 'https://organizer.example/rules'
    if include_complete_page:
        documents.append(document_for(PageIn(url=complete_url, site='Organizer', title='Rules',
            is_official=True), DESCRIPTION, completeness='full'))
    candidate.draft = candidate.draft.model_copy(update={'documents': documents})
    candidate.detail_attempted = True

    async def normalize(item):
        return item.draft

    ctx = context(candidate)
    asyncio.run(StructuredNormalize(normalize).run(ctx))
    missing = candidate.draft.coverage.fields['entry_fee']
    if include_complete_page:
        assert missing.state == 'not_found_in_source'
        assert missing.urls == [complete_url]
        assert missing.reason == 'checked_complete_page_text'
    else:
        assert missing.state == 'not_fetched'
        assert missing.reason == 'only_partial_evidence_available'
        assert set(missing.urls) == {candidate.draft.page.url, snippet_page.url}

    from contest_detective.server.contest.content_service import EXTRACTOR_VERSION
    assert all(document.extractor_version == EXTRACTOR_VERSION == 'content-v1' for document in documents)
