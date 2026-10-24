import copy
import json
from pathlib import Path

import httpx
import pytest

FIXTURES = Path(__file__).parent / 'fixtures'


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding='utf-8'))


def values(draft):
    return {claim.field: claim.value for claim in draft.claims}


def test_one_waytoagi_detail_failure_does_not_discard_other_events():
    from contest_detective.server.research_pipeline.sources.waytoagi import fetch

    listing = load('waytoagi.json')
    healthy = next(item for item in listing['items']
                   if item.get('eventKind') == 'hackathon' and item.get('timeStatus') != 'ended')
    listing['items'] = [{**healthy, 'id': 'unavailable'}, healthy]
    details = load('waytoagi_details.json')

    def handle(request):
        if request.url.path == '/api/events':
            return httpx.Response(200, json=listing)
        event_id = request.url.path.rsplit('/', 1)[-1]
        if event_id == 'unavailable':
            return httpx.Response(500)
        return httpx.Response(200, json=details[event_id])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        drafts = fetch(client)

    assert [draft.name for draft in drafts] == [healthy['title'], healthy['title']]
    assert drafts[0].page.url.endswith('/unavailable')
    assert drafts.inventory.failed == 1
    assert drafts.inventory.reason == 'partial_detail_failure'


def test_one_invalid_hackertrip_event_does_not_discard_other_events():
    from contest_detective.server.research_pipeline.sources.hackertrip import fetch

    healthy = load('hackertrip.json')[0]
    broken = {key: value for key, value in healthy.items() if key != 'name'}
    with httpx.Client(transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=[broken, healthy]))) as client:
        drafts = fetch(client)

    assert [draft.name for draft in drafts] == [healthy['name']]


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
    assert values(first)['start_at'] == '2026-11-13T00:00:00Z'
    assert next(claim for claim in first.claims if claim.field == 'start_at').precision == 'day'


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


@pytest.mark.parametrize(('origin', 'external', 'official'), [
    ('hosted', None, True), ('imported', None, False),
    ('hosted', 'https://elsewhere.example/register', False), ('unknown', None, False),
])
def test_waytoagi_self_hosted_registration_is_official_only_with_trusted_metadata(origin, external, official):
    from contest_detective.server.research_pipeline.sources.waytoagi import fetch

    item = {'id': 'hosted-one', 'title': '主办活动', 'eventKind': 'hackathon',
            'timeStatus': 'upcoming', 'date': '2026-11-01', 'origin': origin, 'externalRegUrl': external}

    def handle(request):
        return httpx.Response(200, json={'ok': True, 'items': [item]} if request.url.path == '/api/events'
                              else {'event': item})

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        draft, = fetch(client)
    assert draft.page.is_official is official
    if official:
        assert values(draft)['registration_url'] == draft.page.url


@pytest.mark.parametrize(('location', 'city', 'mode'), [
    ({'location': 'Harbor Hall'}, None, 'offline'),
    ({'location': 'Harbor Hall', 'city': 'Bay City'}, 'Bay City', 'offline'),
    ({'location': 'Online'}, None, 'online'),
])
def test_devpost_generic_location_is_not_guessed_to_be_a_city(location, city, mode):
    from contest_detective.server.research_pipeline.sources.devpost import _draft
    result = _draft({'title': 'Builder Cup', 'url': 'https://builder-cup.devpost.com/',
        'open_state': 'open', 'displayed_location': location})
    assert values(result).get('city') == city
    assert values(result)['mode'] == mode
    assert next(claim for claim in result.claims if claim.field == 'mode').excerpt == 'location: ' + location['location']


def test_later_devpost_sync_does_not_revive_corrected_venue_as_city(session_factory):
    from contest_detective.framework.config.app import AppSettings
    from contest_detective.server.contest import service
    from contest_detective.server.contest.schemas import ContestDraft, ClaimIn, PageIn
    from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline
    from contest_detective.server.research_pipeline.sources.devpost import _draft
    incoming = _draft({'title': 'Builder Cup', 'url': 'https://builder-cup.devpost.com/',
        'open_state': 'open', 'displayed_location': {'location': 'Harbor Hall'}})
    with session_factory() as session:
        cid = service.save(session, incoming)
        service.save(session, ContestDraft(name='Builder Cup', page=PageIn(
            url='https://organizer.example/builder-cup', site='Organizer', title='Builder Cup', is_official=True),
            claims=[ClaimIn(field='city', value='Bay City', excerpt='Harbor Hall, Bay City')]), contest_id=cid)
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200))) as client:
        result = run_pipeline(session_factory, client=client, sources=[('devpost', lambda _: [incoming])],
            settings=AppSettings(_env_file=None, sync_collect='structured'))
    assert result.saved == 1 and result.failed == 0
    with session_factory() as session:
        city = service.get(session, cid).fields['city']
    assert city.value == 'Bay City' and city.level == 'official'
    assert [source.url for source in city.sources] == ['https://organizer.example/builder-cup']
