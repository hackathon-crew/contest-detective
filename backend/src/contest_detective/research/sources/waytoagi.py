from urllib.parse import quote
import logging
import re

import httpx

from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.research.sources.dates import parse_datetime
from contest_detective.research.sources.batch import SourceBatch
from contest_detective.research.official import is_official_page

API_URL = 'https://events.waytoagi.com/api/events'
logger = logging.getLogger(__name__)


def fetch(client: httpx.Client) -> list[ContestDraft]:
    response = client.get(API_URL)
    response.raise_for_status()
    payload = response.json()
    if not payload.get('ok'):
        raise ValueError('WaytoAGI did not return an event list')
    drafts = SourceBatch('waytoagi')
    drafts.inventory.listing_urls.append(API_URL)
    for item in payload['items']:
        if not isinstance(item, dict) or not item.get('id'):
            drafts.inventory.failed += 1
            drafts.inventory.reason = 'partial_item_failure'
            continue
        if item.get('eventKind') != 'hackathon' or item.get('timeStatus') == 'ended':
            continue
        drafts.inventory.discovered += 1
        event_id = quote(str(item['id']), safe='')
        try:
            detail = client.get(f'{API_URL}/{event_id}')
            detail.raise_for_status()
            event = {**item, **detail.json()['event']}
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            logger.warning('WaytoAGI detail skipped event=%s error_type=%s', item.get('id'), type(exc).__name__)
            drafts.inventory.failed += 1
            drafts.inventory.reason = 'partial_detail_failure'
            event = item
        try:
            drafts.append(_draft(event_id, event))
        except (ValueError, KeyError, TypeError) as exc:
            drafts.inventory.failed += 1
            drafts.inventory.reason = 'partial_item_failure'
            logger.warning('WaytoAGI event skipped error_type=%s', type(exc).__name__)
    drafts.inventory.fetched = len(drafts)
    return drafts


def _draft(event_id, event):
    page_url = f'https://events.waytoagi.com/events/{event_id}'
    official = is_official_page(page_url, origin=event.get('origin'),
                                external_registration=bool(event.get('externalRegUrl')))
    claims = []
    for field, key in [
        ('start_at', 'date'), ('end_at', 'endDate'),
        ('deadline_unspecified', 'deadline'), ('city', 'city'), ('venue', 'venue'),
        ('mode', 'eventMode'), ('organizer', 'organizerName'),
        ('registration_url', 'externalRegUrl'),
    ]:
        raw = event.get(key)
        if raw is None or raw == '':
            continue
        day_only = isinstance(raw, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw.strip()) is not None
        value = parse_datetime(raw, default_timezone='UTC' if day_only else 'Asia/Shanghai') if field in {
            'start_at', 'end_at', 'deadline_unspecified',
        } else str(raw).strip()
        if not value or (field == 'mode' and value not in {'online', 'offline', 'hybrid'}):
            continue
        precision = 'day' if day_only and field in {'start_at', 'end_at', 'deadline_unspecified'} else 'datetime'
        claims.append(ClaimIn(field=field, value=value, precision=precision, excerpt=f'{key}: {raw}'))
    if official:
        claims.append(ClaimIn(field='registration_url', value=page_url,
                              excerpt=f"origin: {event.get('origin')}; externalRegUrl: {event.get('externalRegUrl')}"))
    return ContestDraft(
        name=event['title'], cover_url=event.get('cover'), summary=event.get('description'),
        page=PageIn(url=page_url, site='WaytoAGI', title=event['title'], is_official=official),
        claims=claims,
    )
