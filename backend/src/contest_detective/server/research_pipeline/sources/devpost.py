"""Devpost 报名页的结构化字段；submission 区间不代表实际赛程。"""

import html
import re

import httpx

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.research_pipeline.official import is_official_page
from contest_detective.server.research_pipeline.sources.dates import parse_date_range

API_URL = 'https://devpost.com/api/hackathons'


def fetch(client: httpx.Client) -> list[ContestDraft]:
    drafts = []
    for page in range(1, 6):
        response = client.get(API_URL, params=[
            ('status[]', 'upcoming'), ('status[]', 'open'), ('page', page),
        ])
        response.raise_for_status()
        items = response.json()['hackathons']
        if not items:
            break
        for item in items:
            url = item.get('url') or ''
            if item.get('open_state') not in {'open', 'upcoming'} or not is_official_page(url):
                continue
            claims = [ClaimIn(field='registration_url', value=url, excerpt=f'url: {url}')]
            raw_dates = item.get('submission_period_dates') or ''
            first, last = parse_date_range(raw_dates)
            deadline = last or first
            if deadline:
                claims.append(ClaimIn(field='submission_deadline', value=deadline,
                                      excerpt=f'submission_period_dates: {raw_dates}'))
            location = item.get('displayed_location') or {}
            place = (location.get('location') or '').strip()
            if place.lower() == 'online':
                claims.append(ClaimIn(field='mode', value='online', excerpt=f'location: {place}'))
            elif place:
                claims.extend([
                    ClaimIn(field='city', value=place, excerpt=f'location: {place}'),
                    ClaimIn(field='mode', value='offline', excerpt=f'location: {place}'),
                ])
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
            drafts.append(ContestDraft(
                name=item['title'], cover_url=cover, summary=summary or None,
                page=PageIn(url=url, site='Devpost', title=item['title'], is_official=True),
                claims=claims,
            ))
    return drafts
