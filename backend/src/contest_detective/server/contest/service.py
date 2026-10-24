from datetime import datetime, timedelta, timezone
from typing import get_args
import unicodedata
from uuid import uuid4

from rapidfuzz.fuzz import token_set_ratio
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from .models import Contest, ContestClaim, ContestPage, ContestPageLink
from .schemas import (DATE_FIELDS, DEADLINE_FIELDS, ContestDetail, ContestDraft,
                      ContestField, ContestQuery, ContestSummary, FieldValue, Source,
                      calendar_date, date_bounds, utc_iso)
from .verification import resolve


def _now():
    return datetime.now(timezone.utc)


def _name_tokens(name: str) -> str:
    normalized = unicodedata.normalize('NFKC', name).lower()
    return ' '.join(''.join(char if char.isalnum() else ' ' for char in normalized).split())


def _normalized_name(name: str) -> str:
    return _name_tokens(name).replace(' ', '')


def _start_date(value: str, precision='datetime') -> str:
    return calendar_date(value, precision).isoformat()


def _match(session, draft, page):
    start = next((_start_date(claim.value, claim.precision) for claim in draft.claims if claim.field == 'start_at'), None)
    normalized_name = _normalized_name(draft.name)
    linked = session.scalar(select(Contest).join(ContestPageLink).where(
        ContestPageLink.page_id == page.id, Contest.normalized_name == normalized_name)
        ) if page is not None else None
    if linked is not None:
        return linked
    # 无日期不足以跨来源合并，只认同一网页已保存过的同名赛事。
    if start is None:
        return None
    candidates = session.scalars(select(Contest).where(Contest.start_date == start)).all()
    scored = [(100 if item.normalized_name == normalized_name else
               token_set_ratio(_name_tokens(item.name), _name_tokens(draft.name)), item.id, item)
              for item in candidates]
    matches = [match for match in scored if match[0] >= 90]
    return max(matches, key=lambda match: (match[0], match[1]))[2] if matches else None


def _fields(session, contest_id):
    grouped = {field: [] for field in get_args(ContestField)}
    rows = session.execute(select(ContestClaim, ContestPage).join(
        ContestPage, ContestClaim.page_id == ContestPage.id).where(
        ContestClaim.contest_id == contest_id).order_by(ContestPage.url, ContestClaim.field))
    for claim, page in rows:
        grouped[claim.field].append(Source(url=page.url, site=page.site, title=page.title,
            published_at=page.published_at, is_official=page.is_official,
            value=claim.value, excerpt=claim.excerpt, precision=claim.precision))
    return {field: resolve(field, claims) for field, claims in grouped.items()}


def _next_deadline(fields, now):
    upcoming = [fields[field].value for field in DEADLINE_FIELDS if fields[field].value is not None
                and _deadline_available(fields[field].model_dump(), now)]
    return min(upcoming) if upcoming else None


def _deadline_available(value, now):
    if value.get('value') is None:
        return False
    if value.get('precision') == 'day':
        return now < date_bounds(value['value'], 'day')[1]
    return datetime.fromisoformat(value['value']) >= now


def _refresh(session, contest, now):
    fields = _fields(session, contest.id)
    contest.fields = {field: {'value': result.value, 'level': result.level, 'precision': result.precision}
                      for field, result in fields.items()}
    contest.start_at = fields['start_at'].value
    contest.start_date = _start_date(contest.start_at, fields['start_at'].precision) if contest.start_at else None
    contest.end_at = fields['end_at'].value
    contest.next_deadline = _next_deadline(fields, now)
    contest.mode = fields['mode'].value
    contest.city = fields['city'].value


def _status(contest, now):
    if contest.start_at is None:
        return 'upcoming' if any(_deadline_available(contest.fields.get(field, {}), now)
                                 for field in DEADLINE_FIELDS) else 'ended'
    start = date_bounds(contest.start_at, contest.fields.get('start_at', {}).get('precision', 'datetime'))[0]
    end = date_bounds(contest.end_at, contest.fields.get('end_at', {}).get('precision', 'datetime'))[1] if contest.end_at else start + timedelta(days=1)
    if now < start:
        return 'upcoming'
    return 'ongoing' if now < end else 'ended'


def _summary(contest, now):
    return ContestSummary(id=contest.id, name=contest.name, cover_url=contest.cover_url,
        status=_status(contest, now), fields={field: FieldValue(**value) for field, value in contest.fields.items()})


def match_id(session: Session, draft: ContestDraft) -> str | None:
    page = session.scalar(select(ContestPage).where(ContestPage.url == draft.page.url))
    contest = _match(session, draft, page)
    return None if contest is None else contest.id


def claim_sources(session: Session, contest_id: str) -> list[tuple[str, Source]]:
    rows = session.execute(select(ContestClaim, ContestPage).join(
        ContestPage, ContestClaim.page_id == ContestPage.id).where(ContestClaim.contest_id == contest_id))
    sources = []
    for claim, page in rows:
        published = datetime.fromisoformat(page.published_at) if page.published_at else None
        sources.append((claim.field, Source(
            url=page.url, site=page.site, title=page.title, published_at=published, is_official=page.is_official,
            value=claim.value, excerpt=claim.excerpt, precision=claim.precision,
        )))
    return sources


def save(session: Session, draft: ContestDraft, *, contest_id: str | None = None) -> str:
    page = session.scalar(select(ContestPage).where(ContestPage.url == draft.page.url))
    contest = session.get(Contest, contest_id) if contest_id else _match(session, draft, page)
    if contest_id and contest is None:
        raise ValueError('赛事不存在')
    if contest is None:
        contest = Contest(id=str(uuid4()), name=draft.name, normalized_name=_normalized_name(draft.name))
        session.add(contest)
    if draft.cover_url is not None:
        contest.cover_url = draft.cover_url
    if draft.summary is not None:
        contest.summary = draft.summary
    if page is None:
        page = ContestPage(id=str(uuid4()), url=draft.page.url)
        session.add(page)
    page.site, page.title, page.is_official = draft.page.site, draft.page.title, draft.page.is_official
    page.published_at = utc_iso(draft.page.published_at.isoformat()) if draft.page.published_at else None
    session.flush()
    if session.get(ContestPageLink, (contest.id, page.id)) is None:
        session.add(ContestPageLink(contest_id=contest.id, page_id=page.id))
    affected = set(session.scalars(select(ContestPageLink.contest_id).where(ContestPageLink.page_id == page.id)))
    session.execute(delete(ContestClaim).where(ContestClaim.contest_id == contest.id, ContestClaim.page_id == page.id))
    for claim in {claim.field: claim for claim in draft.claims}.values():
        session.add(ContestClaim(contest_id=contest.id, page_id=page.id, **claim.model_dump()))
    session.flush()
    for contest_id in affected | {contest.id}:
        _refresh(session, session.get(Contest, contest_id), _now())
    session.commit()
    return contest.id


def query(session: Session, q: ContestQuery) -> tuple[list[ContestSummary], int]:
    statement = select(Contest)
    if q.ids is not None:
        statement = statement.where(Contest.id.in_(q.ids))
    if q.mode:
        statement = statement.where(Contest.mode == q.mode)
    if q.keyword:
        keyword = q.keyword.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        statement = statement.where(or_(*(column.ilike(f'%{keyword}%', escape='\\')
            for column in (Contest.name, Contest.summary, Contest.city))))
    now = _now()
    results = []
    for contest in session.scalars(statement):
        summary = _summary(contest, now)
        if q.status and summary.status != q.status:
            continue
        if q.date_from or q.date_to:
            def inside(value):
                start, end = date_bounds(value.value, value.precision)
                after = q.date_from is None or (end > q.date_from if value.precision == 'day' else end >= q.date_from)
                return after and (q.date_to is None or start <= q.date_to)
            if not any(inside(summary.fields[field]) for field in DATE_FIELDS
                       if summary.fields[field].value is not None):
                continue
        value = contest.start_at if q.sort == 'start' else _next_deadline(summary.fields, now)
        results.append(((value is None, value or '', contest.start_at or '', contest.name, contest.id), summary))
    results.sort(key=lambda item: item[0])
    offset = (q.page - 1) * q.page_size
    return [summary for _, summary in results[offset:offset + q.page_size]], len(results)


def get(session: Session, contest_id: str) -> ContestDetail | None:
    contest = session.get(Contest, contest_id)
    if contest is None:
        return None
    return ContestDetail(**(_summary(contest, _now()).model_dump() | {
        'summary': contest.summary, 'fields': _fields(session, contest.id)}))
