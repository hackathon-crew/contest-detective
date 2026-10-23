from urllib.parse import quote

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.sources.dates import parse_datetime
from contest_detective.server.research_pipeline.official import is_official_page

API_URL = 'https://events.waytoagi.com/api/events'


def fetch(client: httpx.Client) -> list[ContestDraft]:
    response = client.get(API_URL)
    response.raise_for_status()
    payload = response.json()
    if not payload.get('ok'):
        raise ValueError('WaytoAGI did not return an event list')
    drafts = []
    for item in payload['items']:
        if item.get('eventKind') != 'hackathon' or item.get('timeStatus') == 'ended':
            continue
        event_id = quote(str(item['id']), safe='')
        detail = client.get(f'{API_URL}/{event_id}')
        detail.raise_for_status()
        event = {**item, **detail.json()['event']}
        page_url = f'https://events.waytoagi.com/events/{event_id}'
        official = is_official_page(page_url, origin=event.get('origin'),
                                    external_registration=bool(event.get('externalRegUrl')))
        claims = []
        for field, key in [
            ('start_at', 'date'), ('end_at', 'endDate'),
            ('deadline_unspecified', 'deadline'), ('city', 'city'),
            ('mode', 'eventMode'), ('organizer', 'organizerName'),
            ('registration_url', 'externalRegUrl'),
        ]:
            raw = event.get(key)
            if raw is None or raw == '':
                continue
            value = parse_datetime(raw, default_timezone='Asia/Shanghai') if field in {
                'start_at', 'end_at', 'deadline_unspecified',
            } else str(raw).strip()
            if not value or (field == 'mode' and value not in {'online', 'offline', 'hybrid'}):
                continue
            claims.append(ClaimIn(field=field, value=value, excerpt=f'{key}: {raw}'))
        if official:
            claims.append(ClaimIn(field='registration_url', value=page_url,
                                  excerpt=f"origin: {event.get('origin')}; externalRegUrl: {event.get('externalRegUrl')}"))
        drafts.append(ContestDraft(
            name=event['title'], cover_url=event.get('cover'), summary=event.get('description'),
            page=PageIn(url=page_url, site='WaytoAGI', title=event['title'], is_official=official),
            claims=claims,
        ))
    return drafts
