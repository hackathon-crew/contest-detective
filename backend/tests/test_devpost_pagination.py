import httpx

from contest_detective.research.sources.devpost import fetch


def item(number):
    return {'id': number, 'title': f'Fixture {number}', 'url': f'https://fixture{number}.devpost.com/',
        'open_state': 'open', 'themes': [{'name': 'AI'}]}


def test_metadata_drives_pagination_beyond_twenty_pages_and_exposes_themes():
    pages = []

    def handle(request):
        page = int(request.url.params['page'])
        pages.append(page)
        return httpx.Response(200, json={'hackathons': [item(page)], 'meta': {'total_count': 23, 'per_page': 1}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)
    assert pages == list(range(1, 24))
    assert len(drafts) == 23
    assert drafts[-1].themes == ['AI']
    assert drafts.inventory.termination == 'exhausted'
    assert drafts.inventory.discovered == drafts.inventory.fetched == 23


def test_failed_later_page_keeps_already_collected_events():
    def handle(request):
        page = int(request.url.params['page'])
        return httpx.Response(503) if page == 2 else httpx.Response(200, json={
            'hackathons': [item(page)], 'meta': {'total_count': 3, 'per_page': 1}})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)
    assert len(drafts) == 1
    assert drafts.inventory.failed == 1
    assert drafts.inventory.termination == 'failed'


def test_repeated_page_is_bounded_and_does_not_duplicate_entries():
    calls = []

    def handle(request):
        calls.append(request.url.params['page'])
        return httpx.Response(200, json={'hackathons': [item(1)]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)
    assert calls == ['1', '2']
    assert len(drafts) == 1
    assert drafts.inventory.reason == 'repeated_page'
