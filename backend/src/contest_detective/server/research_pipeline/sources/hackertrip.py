import logging

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.sources.dates import parse_datetime
from contest_detective.server.research_pipeline.sources.batch import SourceBatch

API_URL = 'https://hackertrip.space/api/hackathons'
logger = logging.getLogger(__name__)


def fetch(client: httpx.Client) -> list[ContestDraft]:
    response = client.get(API_URL)
    response.raise_for_status()
    drafts = SourceBatch('hackertrip')
    drafts.inventory.listing_urls.append(API_URL)
    for item in response.json():
        if not isinstance(item, dict):
            drafts.inventory.failed += 1
            continue
        if item.get('isPast'):
            continue
        drafts.inventory.discovered += 1
        try:
            drafts.append(_draft(item))
        except (ValueError, KeyError, TypeError) as exc:
            drafts.inventory.failed += 1
            logger.warning('HackerTrip event skipped event=%s error_type=%s', item.get('id'), type(exc).__name__)
    drafts.inventory.fetched = len(drafts)
    return drafts


def _draft(item):
    claims = []
    fields = [
        ('start_at', 'startDate'), ('end_at', 'endDate'),
        ('registration_deadline', 'registrationDeadline'),
        ('city', 'city'), ('venue', 'venue'), ('mode', 'mode'), ('prize', 'prizePool'),
        ('organizer', 'hostOrganizer'),
    ]
    for field, key in fields:
        raw = item.get(key)
        if raw is None or raw == '':
            continue
        value = parse_datetime(raw) if field in {
            'start_at', 'end_at', 'registration_deadline',
        } else str(raw).strip()
        if not value or (field == 'mode' and value not in {'online', 'offline', 'hybrid'}):
            continue
        claims.append(ClaimIn(field=field, value=value, excerpt=f'{key}: {raw}'))
    registration = item.get('registration')
    registration_url = registration.get('url') if isinstance(registration, dict) else None
    key = 'registration.url' if registration_url else 'website'
    registration_url = registration_url or item.get('website')
    if registration_url:
        claims.append(ClaimIn(field='registration_url', value=registration_url,
                              excerpt=f'{key}: {registration_url}'))
    return ContestDraft(
        name=item['name'], cover_url=item.get('coverImage'), summary=item.get('summary'),
        page=PageIn(url=f'https://hackertrip.space/hackathon/{item["id"]}',
                    site='HackerTrip', title=item['name'], is_official=False),
        claims=claims,
    )
