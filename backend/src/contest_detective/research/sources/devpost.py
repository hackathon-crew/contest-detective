"""Devpost 报名页的结构化字段；submission 区间不代表实际赛程。"""

import html
import re
from math import ceil

import httpx

from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.research.official import is_official_page
from contest_detective.research.sources.dates import parse_date_range
from contest_detective.research.sources.batch import SourceBatch

API_URL = 'https://devpost.com/api/hackathons'


def fetch(client: httpx.Client, *, max_pages: int = 200) -> list[ContestDraft]:
    drafts = SourceBatch('devpost')
    seen = set()
    for page in range(1, max_pages + 1):
        try:
            response = client.get(API_URL, params=[
                ('status[]', 'upcoming'), ('status[]', 'open'), ('page', page),
            ])
            drafts.inventory.listing_urls.append(str(response.request.url))
            response.raise_for_status()
            payload = response.json()
            items = payload['hackathons']
            if not isinstance(items, list):
                raise ValueError('invalid_hackathon_list')
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            drafts.inventory.failed += 1
            drafts.inventory.termination = 'failed'
            drafts.inventory.reason = type(exc).__name__
            break
        if not items:
            break
        fresh = [item for item in items if isinstance(item, dict)
                 and (item.get('id') or item.get('url')) not in seen]
        if not fresh:
            drafts.inventory.termination = 'bounded'
            drafts.inventory.reason = 'repeated_page'
            break
        for item in fresh:
            seen.add(item.get('id') or item.get('url'))
            drafts.inventory.discovered += 1
            try:
                draft = _draft(item)
            except (ValueError, KeyError, TypeError, AttributeError):
                drafts.inventory.failed += 1
                continue
            if draft is not None:
                drafts.append(draft)
        meta = payload.get('meta') or {}
        if not isinstance(meta, dict):
            meta = {}
        total, per_page = meta.get('total_count'), meta.get('per_page')
        total_pages = meta.get('total_pages')
        if not isinstance(total_pages, int) and isinstance(total, int) and isinstance(per_page, int) and per_page > 0:
            total_pages = ceil(total / per_page)
        if isinstance(total_pages, int) and page >= total_pages:
            break
        if 'next_page' in meta and meta['next_page'] is None:
            break
    else:
        drafts.inventory.termination = 'bounded'
        drafts.inventory.reason = 'page_safety_limit'
    drafts.inventory.fetched = len(drafts)
    return drafts


def _draft(item):
    url = item.get('url') or ''
    if item.get('open_state') not in {'open', 'upcoming'} or not is_official_page(url):
        return None
    claims = [ClaimIn(field='registration_url', value=url, excerpt=f'url: {url}')]
    raw_dates = item.get('submission_period_dates') or ''
    first, last = parse_date_range(raw_dates)
    deadline = last or first
    if deadline:
        claims.append(ClaimIn(field='submission_deadline', value=deadline,
                              precision='day', excerpt=f'submission_period_dates: {raw_dates}'))
    location = item.get('displayed_location') or {}
    place = (location.get('location') or '').strip()
    if place.lower() == 'online':
        claims.append(ClaimIn(field='mode', value='online', excerpt=f'location: {place}'))
    elif place:
        # displayed_location is generic venue/location text, not an explicit city.
        # Keep that raw context as evidence for physical attendance; never geocode it.
        claims.append(ClaimIn(field='mode', value='offline', excerpt=f'location: {place}'))
        city = location.get('city')
        if isinstance(city, str) and city.strip():
            claims.append(ClaimIn(field='city', value=city.strip(), excerpt=f'city: {city}'))
    for field, key in [
        ('organizer', 'organization_name'), ('prize', 'prize_amount'),
        ('eligibility', 'eligibility_requirement_invite_only_description'),
    ]:
        raw = item.get(key)
        if raw:
            value = html.unescape(re.sub(r'<[^>]+>', '', str(raw))).strip()
            if value:
                claims.append(ClaimIn(field=field, value=value, excerpt=f'{key}: {raw}'))
    cover = item.get('thumbnail_url') or None
    if cover and cover.startswith('//'):
        cover = 'https:' + cover
    themes = '、'.join(theme['name'] for theme in item.get('themes', []) if theme.get('name'))
    summary = '\n\n'.join(part for part in [themes, f'提交区间：{raw_dates}' if deadline else ''] if part)
    return ContestDraft(
        name=item['title'], cover_url=cover, summary=summary or None,
        themes=[theme['name'] for theme in item.get('themes', []) if theme.get('name')],
        page=PageIn(url=url, site='Devpost', title=item['title'], is_official=True),
        claims=claims,
    )
