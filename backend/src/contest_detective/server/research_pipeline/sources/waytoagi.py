from urllib.parse import quote

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.sources.dates import parse_datetime

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
        drafts.append(ContestDraft(
            name=event['title'], cover_url=event.get('cover'), summary=event.get('description'),
            page=PageIn(url=f'https://events.waytoagi.com/events/{event_id}',
                        site='WaytoAGI', title=event['title'], is_official=False),
            claims=claims,
        ))
    return drafts
