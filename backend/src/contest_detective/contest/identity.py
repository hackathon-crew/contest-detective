"""确定性的赛事身份比较，供 source 去重和比赛库匹配共同使用。"""

from datetime import date
from urllib.parse import urlsplit, urlunsplit
import unicodedata

from rapidfuzz.fuzz import token_set_ratio

from .schemas import calendar_date


def normalized_name(name: str) -> str:
    value = unicodedata.normalize('NFKC', name).casefold()
    return ''.join(char for char in value if char.isalnum())


def name_tokens(name: str) -> str:
    value = unicodedata.normalize('NFKC', name).casefold()
    return ' '.join(''.join(char if char.isalnum() else ' ' for char in value).split())


def name_score(left: str, right: str) -> float:
    if normalized_name(left) == normalized_name(right):
        return 100
    return token_set_ratio(name_tokens(left), name_tokens(right))


def normalized_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        return url.strip()
    host = parsed.hostname.casefold().rstrip('.')
    netloc = host
    if parsed.port is not None:
        netloc += f':{parsed.port}'
    return urlunsplit((parsed.scheme.casefold(), netloc, parsed.path or '/', parsed.query, ''))


def claim_value(draft, field: str):
    return next((claim for claim in draft.claims if claim.field == field), None)


def start_calendar_date(draft) -> date | None:
    claim = claim_value(draft, 'start_at')
    return calendar_date(claim.value, claim.precision) if claim else None


def can_merge(left, right) -> bool:
    left_url = claim_value(left, 'registration_url')
    right_url = claim_value(right, 'registration_url')
    if left_url and right_url and normalized_url(left_url.value) == normalized_url(right_url.value):
        return True
    left_day = start_calendar_date(left)
    right_day = start_calendar_date(right)
    return left_day is not None and left_day == right_day and name_score(left.name, right.name) >= 90
