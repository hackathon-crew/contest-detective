import asyncio
from pathlib import Path

import httpx

from contest_detective.server.contest.schemas import ContestDraft, ContestQuery
from contest_detective.server.contest.service import get, query

FIXTURE = Path(__file__).parent / 'fixtures/ethglobal.html'


def listing(count):
    cards = ''.join(f'<a href="/events/e{index}">Event {index} IRL Hackathon</a>' for index in range(count))
    return f'<main><div><h2>Upcoming <span>{count}</span></h2>{cards}</div><div><h2>Past</h2><a href="/events/old">Past Hackathon</a></div></main>'


def test_public_snapshot_selects_upcoming_hackathons_without_historical_or_signed_assets():
    from contest_detective.server.research_pipeline.sources.ethglobal import discover_urls

    snapshot = FIXTURE.read_text()
    assert discover_urls(snapshot) == ['https://ethglobal.com/events/mumbai']
    assert '/events/tokyo2026' in snapshot
    assert 'Conference' in snapshot
    assert '<script' not in snapshot and 'X-Amz-' not in snapshot


def test_discovery_canonicalizes_unique_public_event_urls_and_rejects_other_paths():
    from contest_detective.server.research_pipeline.sources.ethglobal import discover_urls

    document = '''<div><h2>Upcoming <span>10</span></h2>
      <a href="/events/mumbai?tracking=1">IRL Hackathon</a>
      <a href="https://www.ethglobal.com/events/mumbai/#info">IRL Hackathon</a>
      <a href="https://ethglobal.com.evil.example/events/other">Hackathon</a>
      <a href="https://user:password@ethglobal.com/events/other">Hackathon</a>
      <a href="http://ethglobal.com/events/other">Hackathon</a>
      <a href="/events/mumbai/prizes">Hackathon</a>
      <a href="https://[invalid/events/other">Hackathon</a>
      <a href="/events/pragma-mumbai">Conference</a></div>'''
    assert discover_urls(document) == ['https://ethglobal.com/events/mumbai']
    assert discover_urls('<div><h2>Past</h2><a href="/events/old">Hackathon</a></div>') == []
    assert discover_urls('') == []


def test_discovery_caps_the_unique_upcoming_batch_at_eight_pages():
    from contest_detective.server.research_pipeline.sources.ethglobal import discover_urls

    assert discover_urls(listing(12)) == [f'https://ethglobal.com/events/e{index}' for index in range(8)]


def test_sync_isolates_failed_pages_and_saves_supported_claims_with_original_precision(session_factory, monkeypatch):
    from contest_detective.server.research_pipeline import record
    from contest_detective.server.research_pipeline.pages import fetch_page
    from contest_detective.server.research_pipeline.sources.ethglobal import sync

    visits, waits = [], []

    async def pause(seconds):
        waits.append(seconds)

    async def extractor(url, text):
        assert '2026-11-05' in text
        return ContestDraft(name=url.rsplit('/', 1)[-1],
            page={'url': 'https://incorrect.example/', 'site': '来源', 'title': '活动', 'is_official': False},
            claims=[{'field': 'start_at', 'value': '2026-11-05', 'precision': 'day',
                     'excerpt': '不存在的日期摘录' if url.endswith('/e2') else '2026-11-05'}])

    def handle(request):
        if request.url.path == '/events':
            return httpx.Response(200, text=listing(12))
        visits.append(request.url.path)
        if request.url.path == '/events/e1':
            return httpx.Response(503)
        return httpx.Response(200, text='本活动于2026-11-05举行，具体时刻另行公布。',
                              headers={'content-type': 'text/plain'})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(record, 'fetch_page', lambda url: fetch_page(url, client=client,
            resolver=lambda *_args, **_kwargs: [(None, None, None, None, ('8.8.8.8', 443))]))
        report = asyncio.run(sync(extractor=extractor, session_factory=session_factory, client=client, sleep=pause))
    assert report.model_dump() == {'discovered': 8, 'saved': 6, 'failed': 1, 'skipped': 1}
    assert visits == [f'/events/e{index}' for index in range(8)]
    assert waits == [2] * 8
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 6
        for item in items:
            field = get(session, item.id).fields['start_at']
            assert (field.value, field.precision, field.level) == ('2026-11-05T00:00:00Z', 'day', 'official')
            assert field.sources[0].url == f'https://ethglobal.com/events/{item.name}'


def test_disabled_sync_does_not_fetch_an_index_or_extract_a_page(session_factory):
    from contest_detective.server.research_pipeline.sources.ethglobal import sync

    def forbidden(*_args, **_kwargs):
        raise AssertionError('Disabled extraction must not read any page')

    with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
        report = asyncio.run(sync(extractor=None, session_factory=session_factory, client=client, runner=forbidden))
    assert report.model_dump() == {'discovered': 0, 'saved': 0, 'failed': 0, 'skipped': 0}


def test_default_enrichment_registers_ethglobal_and_disabled_rounds_skip_it(session_factory):
    from contest_detective.server.research_pipeline.service import extraction_adapters, run_sync
    from contest_detective.server.research_pipeline.sources.ethglobal import sync

    assert dict(extraction_adapters())['ethglobal'] is sync
    def forbidden(_request):
        raise AssertionError('Disabled extraction must not read any page')
    with httpx.Client(transport=httpx.MockTransport(forbidden)) as client:
        report = run_sync(session_factory, sources=[], client=client)
    assert report.extraction_enabled is False
    assert report.saved == report.failed == 0
