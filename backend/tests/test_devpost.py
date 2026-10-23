import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from contest_detective.server.contest import service as contests
from contest_detective.server.contest.schemas import ContestQuery


def snapshots():
    return json.loads((Path(__file__).parent / 'fixtures/devpost.json').read_text())


def values(draft):
    return {claim.field: claim.value for claim in draft.claims}


def test_devpost_replays_five_public_pages_without_confusing_submission_and_schedule():
    from contest_detective.server.research_pipeline.sources.devpost import fetch

    pages = snapshots()
    calls = []

    def handle(request):
        assert request.url.params.get_list('status[]') == ['upcoming', 'open']
        page = request.url.params['page']
        calls.append(page)
        return httpx.Response(200, json=pages[page])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)

    assert calls == ['1', '2', '3', '4', '5']
    assert len(drafts) == 45
    first = drafts[0]
    assert first.page.url == 'https://amazonappdev2026.devpost.com/'
    assert first.page.is_official is True
    assert values(first)['registration_url'] == first.page.url
    assert values(first)['submission_deadline'] == '2026-10-23T00:00:00Z'
    assert 'start_at' not in values(first)
    assert 'end_at' not in values(first)
    assert 'registration_deadline' not in values(first)
    assert values(first)['mode'] == 'online'
    assert values(first)['organizer'] == 'Amazon'
    assert values(first)['prize'] == '$138,000'
    assert first.cover_url.startswith('https://')
    assert 'Aug 31 - Oct 23, 2026' in first.summary
    assert next(c.excerpt for c in first.claims if c.field == 'submission_deadline') == (
        'submission_period_dates: Aug 31 - Oct 23, 2026'
    )
    shared_month = next(d for d in drafts if d.name == 'Life After Code')
    assert values(shared_month)['submission_deadline'] == '2026-10-27T00:00:00Z'


def test_devpost_stops_on_empty_page_and_does_not_invent_missing_fields():
    from contest_detective.server.research_pipeline.sources.devpost import fetch

    event = copy.deepcopy(snapshots()['1']['hackathons'][0])
    event.update(displayed_location={}, submission_period_dates='not supplied',
                 organization_name=None, prize_amount=None, thumbnail_url=None)
    calls = []

    def handle(request):
        page = int(request.url.params['page'])
        calls.append(page)
        return httpx.Response(200, json={'hackathons': [event] if page == 1 else []})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        draft, = fetch(client)

    assert calls == [1, 2]
    assert values(draft) == {'registration_url': draft.page.url}
    assert draft.cover_url is None


def test_devpost_ignores_closed_events_and_untrusted_registration_hosts():
    from contest_detective.server.research_pipeline.sources.devpost import fetch

    valid = copy.deepcopy(snapshots()['1']['hackathons'][0])
    closed = {**valid, 'open_state': 'closed'}
    outside = {**valid, 'url': 'https://devpost.com.evil.example/'}
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(
        200, json={'hackathons': [closed, outside]},
    ))) as client:
        assert fetch(client) == []


def test_devpost_fixture_saves_official_evidence_and_future_deadlines_remain_upcoming(session, monkeypatch):
    from contest_detective.server.research_pipeline.sources.devpost import fetch

    monkeypatch.setattr(contests, '_now', lambda: datetime(2026, 10, 24, tzinfo=timezone.utc))
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(
        200, json=snapshots()['1'] if request.url.params['page'] == '1' else {'hackathons': []},
    ))) as client:
        drafts = fetch(client)
    ids = [contests.save(session, draft) for draft in drafts]
    first = contests.get(session, ids[0])
    second = contests.get(session, ids[1])
    assert first.status == 'ended'
    assert second.status == 'upcoming'
    assert second.fields['submission_deadline'].level == 'official'
    assert second.fields['start_at'].level == 'not_found'
    assert len(contests.query(session, ContestQuery(status='upcoming'))[0]) == 8
