from datetime import datetime, timezone

import httpx

from contest_detective.framework.config.app import AppSettings
from contest_detective.contest import service
from contest_detective.contest.content import CoverageObservation
from contest_detective.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.research.detail import document_for
from contest_detective.research.detail_contracts import DetailFetchResult
from contest_detective.research.pipeline.execute import run_pipeline
from contest_detective.research.pipeline.models import ContestRecord, ContestSyncContext, ContestSyncInput

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)
DESCRIPTION = 'This hackathon invites student developers to build practical projects together.'


def draft(url, *, name='Fixture Hackathon', themes=None):
    return ContestDraft(name=name, themes=themes, page=PageIn(url=url,
        site='Fixture source', title=name, is_official=True), claims=[
        ClaimIn(field='start_at', value='2026-12-01T00:00:00Z', excerpt='December 1, 2026'),
    ])


def test_detail_body_intro_and_metadata_reach_list_detail_without_republishing_body(session_factory, client):
    original = draft('https://fixture.devpost.com/', themes=['AI', 'Education'])
    original.summary = 'AI、Education\n\n提交区间：Nov 1 - 3, 2026'

    async def fetch(target):
        document = document_for(target.page, DESCRIPTION + '\n\nCity: Beijing.', now=NOW)
        return DetailFetchResult(document=document, coverage=CoverageObservation(state='found', urls=[document.url]))

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as http:
        report = run_pipeline(session_factory, client=http, sources=[('devpost', lambda _: [original])],
            settings=AppSettings(_env_file=None, sync_collect='structured'), detail_fetcher=fetch)
    assert report.failed == 0
    assert report.saved == 1
    assert report.stage_counts['persist']['saved_pages'] == 2
    contest_id = report.records[0].contest_id
    listing = client.get('/contests', params={'ids': contest_id}).json()['data'][0]
    detail = client.get(f'/contests/{contest_id}').json()['data']
    assert listing['introduction']['text'] == DESCRIPTION
    assert 'documents' not in listing
    assert detail['introduction'] == listing['introduction']
    assert all(document['body'] is None for document in detail['documents'])
    assert {document['url'] for document in detail['documents']} == {
        original.page.url, 'https://fixture.devpost.com/rules',
    }
    assert detail['themes'] == ['AI', 'Education']
    assert {source['url'] for source in detail['theme_sources']} == {original.page.url}


def test_atomic_multisource_failure_rolls_back_only_bad_contest_and_reports_safe_error(session_factory, monkeypatch):
    from contest_detective.contest.schemas import FieldValue, Source
    import importlib

    module = importlib.import_module('contest_detective.research.pipeline.persist')
    real_save = module.save

    def fail_second_page(session, incoming, **kwargs):
        if incoming.page.url.endswith('/bad-second'):
            raise RuntimeError('sensitive-body-must-not-appear')
        return real_save(session, incoming, **kwargs)

    monkeypatch.setattr(module, 'save', fail_second_page)

    def record(name, paths):
        return ContestRecord(name=name, fields={'city': FieldValue(value='Beijing', level='official', sources=[
            Source(url='https://organizer.example/' + path, site='Organizer', title=name,
                is_official=True, value='Beijing', excerpt='City: Beijing.') for path in paths])})

    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('hackathon',)), records=[
        record('Bad contest', ['bad-first', 'bad-second']), record('Healthy contest', ['healthy']),
    ])
    assert module.persist(session_factory, ctx) == 1
    assert len(ctx.records) == 1
    assert ctx.records[0].name == 'Healthy contest'
    assert ctx.failed == 1
    assert ctx.stage_counts['persist'] == {'attempted': 2, 'failed': 1, 'saved': 1, 'saved_pages': 1}
    assert ctx.failures[0].stage == 'persist'
    assert 'sensitive-body' not in ctx.failures[0].reason
    with session_factory() as session:
        items, total = service.query(session, ContestQuery())
    assert total == 1
    assert items[0].name == 'Healthy contest'


def test_body_only_candidate_is_saved_without_model_calls(session_factory):
    original = draft('https://fixture.devpost.com/')
    original.claims = []

    async def fetch(target):
        document = document_for(target.page, DESCRIPTION, now=NOW)
        return DetailFetchResult(document=document, coverage=CoverageObservation(state='found', urls=[document.url]))

    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as http:
        report = run_pipeline(session_factory, client=http, sources=[('devpost', lambda _: [original])],
            settings=AppSettings(_env_file=None, sync_collect='structured'), detail_fetcher=fetch)
    assert report.failed == 0
    assert report.saved == 1
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
    assert detail.introduction.text == DESCRIPTION
    assert len(detail.documents) == 2


def test_denied_detail_is_not_retried_through_unprotected_legacy_reader(session_factory, monkeypatch):
    from contest_detective.research import pages

    original = draft('https://fixture.devpost.com/')
    original.claims.append(ClaimIn(field='registration_url', value=original.page.url, excerpt=original.page.url))
    attempted = []

    async def deny(target):
        attempted.append(target.page.url)
        return DetailFetchResult(coverage=CoverageObservation(state='fetch_failed',
            urls=[target.page.url], reason='robots_denied'))

    def forbidden(_url):
        raise AssertionError('Legacy reader must not bypass the configured access policy')

    async def extractor(_url, _body):
        raise AssertionError('Denied body must not reach extraction')

    monkeypatch.setattr(pages, 'fetch_page', forbidden)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as http:
        report = run_pipeline(session_factory, client=http, sources=[('devpost', lambda _: [original])],
            settings=AppSettings(_env_file=None, sync_collect='both'), detail_fetcher=deny,
            extractor=extractor, searcher=lambda *_a, **_k: [], listings=[], now=NOW)
    assert report.saved == 1
    assert report.failed == 3
    assert attempted == [original.page.url, 'https://fixture.devpost.com/rules', original.page.url]
