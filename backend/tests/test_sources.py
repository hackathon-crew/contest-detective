import copy
import json
from pathlib import Path

import httpx

FIXTURES = Path(__file__).parent / 'fixtures'


def load(name):
    return json.loads((FIXTURES / name).read_text())


def values(draft):
    return {claim.field: claim.value for claim in draft.claims}


def test_hackertrip_replays_public_snapshot_and_skips_past_events():
    from contest_detective.server.research_pipeline.sources.hackertrip import fetch

    def handle(request):
        assert str(request.url) == 'https://hackertrip.space/api/hackathons'
        return httpx.Response(200, json=load('hackertrip.json'))

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)

    assert len(drafts) == 17
    first = drafts[0]
    assert first.name == '雾客松 2027（WAKEATHON）重庆跨年 AI 黑客松'
    assert first.page.url == 'https://hackertrip.space/hackathon/ht-2027'
    assert first.page.is_official is False
    assert values(first)['start_at'] == '2027-01-22T00:00:00Z'
    assert values(first)['registration_deadline'] == '2027-01-10T15:59:59Z'
    assert values(first)['mode'] == 'hybrid'
    assert values(first)['registration_url'].startswith('https://www.feishu.cn/')
    assert next(c for c in first.claims if c.field == 'start_at').excerpt == (
        'startDate: 2027-01-22T00:00:00.000Z'
    )


def test_hackertrip_uses_website_when_registration_url_is_missing():
    from contest_detective.server.research_pipeline.sources.hackertrip import fetch

    item = copy.deepcopy(load('hackertrip.json')[0])
    item['registration'] = None
    item['registrationDeadline'] = None
    item['mode'] = 'unknown'
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[item]))) as client:
        draft, = fetch(client)

    assert values(draft)['registration_url'] == item['website']
    assert 'registration_deadline' not in values(draft)
    assert 'mode' not in values(draft)


def test_waytoagi_replays_snapshot_and_fetches_only_active_hackathon_details():
    from contest_detective.server.research_pipeline.sources.waytoagi import fetch

    details = load('waytoagi_details.json')

    def handle(request):
        if request.url.path == '/api/events':
            return httpx.Response(200, json=load('waytoagi.json'))
        event_id = request.url.path.rsplit('/', 1)[-1]
        assert event_id in details
        return httpx.Response(200, json=details[event_id])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)

    assert len(drafts) == 51
    first = drafts[0]
    assert first.name == '第四届开放原子大赛—2026开源行业解决方案创新赛'
    assert first.page.url == 'https://events.waytoagi.com/events/e_fa883cfcd9'
    assert first.page.is_official is False
    assert values(first)['start_at'] == '2026-11-12T16:00:00Z'


def test_waytoagi_does_not_guess_the_deadline_type():
    from contest_detective.server.research_pipeline.sources.waytoagi import fetch

    item = {'id': 'one', 'title': '测试赛事', 'eventKind': 'hackathon',
            'timeStatus': 'upcoming', 'date': '2026-11-01', 'eventMode': 'online'}

    def handle(request):
        payload = {'ok': True, 'items': [item]} if request.url.path == '/api/events' else {
            'event': {**item, 'deadline': '2026-10-31T23:59', 'description': '公开介绍'},
        }
        return httpx.Response(200, json=payload)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        draft, = fetch(client)

    assert values(draft)['deadline_unspecified'] == '2026-10-31T15:59:00Z'
    assert 'registration_deadline' not in values(draft)
    assert 'submission_deadline' not in values(draft)
    assert draft.summary == '公开介绍'
