from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from contextvars import ContextVar
from hashlib import sha256
import json
from typing import get_args
from types import SimpleNamespace
import re
from urllib.parse import urlsplit
import unicodedata
from uuid import uuid4

from rapidfuzz.fuzz import token_set_ratio
from sqlalchemy import and_, case, delete, exists, func, or_, select, union_all
from sqlalchemy.orm import Session

from .identity import name_tokens as _identity_name_tokens, normalized_name as _identity_normalized_name
from .models import Contest, ContestClaim, ContestDetails, ContestPage, ContestPageLink, ContestEvent
from .schemas import (DATE_FIELDS, DEADLINE_FIELDS, DEFAULT_EVIDENCE_FIELDS, EvidenceField, BriefDate, BriefDeadline, ContestBrief, ContestDetail, ContestDraft, ContestEvidence,
                      ContestField, ContestQuery, ContestSummary, FieldResolution, FieldValue, Source,
                      calendar_date, date_bounds, utc_iso)
from .verification import resolve, resolution_matches
from .events import ContestSnapshot
from .content import ContentCoverage, ContestDocument, ContestIntroduction, CoverageObservation
from .content_service import build_introduction, document_key, normalized_text, public_document, validate_document, validate_introduction


def _now():
    return datetime.now(timezone.utc)


def _instant(value):
    delta = value - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def _date_projection(fields):
    projection = {}
    for field in DATE_FIELDS:
        value = fields.get(field, {})
        bounds = date_bounds(value['value'], value.get('precision', 'datetime')) if value.get('value') else (None, None)
        for bound, instant in zip(('lower', 'upper'), bounds):
            projection[f'{field}_{bound}'] = _instant(instant) if instant is not None else None
    return projection


def _name_tokens(name: str) -> str:
    return _identity_name_tokens(name)


def _normalized_name(name: str) -> str:
    return _identity_normalized_name(name)


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
    decisions = field_resolutions(session, contest_id)
    return {field: resolve(field, claims, decisions.get(field)) for field, claims in grouped.items()}


def field_resolutions(session, contest_id):
    details = session.get(ContestDetails, contest_id)
    return {field: FieldResolution.model_validate(item['resolution'])
            for field, item in (details.fields if details else {}).items() if 'resolution' in item}


def apply_field_resolutions(session, contest_id, decisions):
    """只更新派生判断；模型请求期间变化的原始来源不能被旧结果覆盖。"""
    session.flush()
    if session.get_bind().dialect.name == 'sqlite':
        session.connection().exec_driver_sql('UPDATE contests SET id = id WHERE 0')
    session.expire_all()
    contest = session.get(Contest, contest_id)
    if contest is None:
        raise ValueError('赛事不存在')
    fields = _fields(session, contest_id)
    if any(field not in fields or not resolution_matches(field, fields[field].sources, decision)
           for field, decision in decisions.items()):
        raise ValueError('参与判断的来源已变化，需要重新整理')
    details = _details(session, contest)
    details.fields = {**details.fields, **{field: {
        **details.fields.get(field, {}), 'resolution': decision.model_dump()}
        for field, decision in decisions.items()}}
    _refresh(session, contest, _now())
    session.commit()


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


def _brief_date(value: FieldValue) -> BriefDate | None:
    if value.value is None:
        return None
    return BriefDate(value=calendar_date(value.value, 'day').isoformat() if value.precision == 'day' else value.value,
                     precision=value.precision)


def brief(item: ContestSummary, *, now: datetime | None = None) -> ContestBrief:
    now = _now() if now is None else now
    fields = item.fields
    deadline = min((name for name in DEADLINE_FIELDS if _deadline_available(
        {'value': fields[name].value, 'precision': fields[name].precision}, now)),
        key=lambda name: fields[name].value, default=None)
    return ContestBrief(id=item.id, name=item.name[:160], status=item.status,
        start_at=_brief_date(fields['start_at']), end_at=_brief_date(fields['end_at']),
        next_deadline=BriefDeadline(field=deadline, **_brief_date(fields[deadline]).model_dump()) if deadline else None,
        city=fields['city'].value[:80] if fields['city'].value is not None else None,
        mode=fields['mode'].value,
        prize=fields['prize'].value[:160] if fields['prize'].value is not None else None,
        themes=[theme[:40] for theme in item.themes[:6]])


def evidence(item: ContestDetail, fields: list[EvidenceField] | None = None) -> ContestEvidence:
    names = DEFAULT_EVIDENCE_FIELDS if fields is None else fields
    selected = {name: item.fields[name] for name in names if name != 'summary'}
    return ContestEvidence(id=item.id, name=item.name, status=item.status, fields=selected,
        **({'summary': item.summary} if 'summary' in names else {}))


def _details(session, contest):
    details = session.get(ContestDetails, contest.id)
    if details is None:
        details = ContestDetails(contest_id=contest.id, fields={})
        session.add(details)
        session.flush()
    return details


def _refresh(session, contest, now):
    fields = _fields(session, contest.id)
    details = _details(session, contest)
    decisions = field_resolutions(session, contest.id)
    details.fields = {field: {'value': result.value, 'level': result.level, 'precision': result.precision,
        **({'resolution': decisions[field].model_dump()} if field in decisions
           and resolution_matches(field, result.sources, decisions[field]) else {})}
        for field, result in fields.items()}
    details.coverage = _coverage(details, fields, None).model_dump(mode='json')
    for column, value in _date_projection(details.fields).items():
        setattr(details, column, value)
    details.start_at = fields['start_at'].value
    contest.start_date = _start_date(details.start_at, fields['start_at'].precision) if details.start_at else None
    contest.cover_url = details.cover_url
    contest.summary = details.summary
    contest.start_at = details.start_at
    details.end_at = fields['end_at'].value
    details.next_deadline = _next_deadline(fields, now)
    details.mode = fields['mode'].value
    details.city = fields['city'].value
    contest.end_at = details.end_at
    contest.next_deadline = details.next_deadline
    contest.mode = details.mode
    contest.city = details.city
    contest.fields = details.fields


def _status(contest, details, now):
    if details.start_at is None:
        if details.end_at and now >= date_bounds(details.end_at, details.fields.get('end_at', {}).get('precision', 'datetime'))[1]:
            return 'ended'
        deadlines = [details.fields[field] for field in DEADLINE_FIELDS if details.fields.get(field, {}).get('value')]
        return 'upcoming' if not deadlines or any(_deadline_available(value, now) for value in deadlines) else 'ended'
    start = date_bounds(details.start_at, details.fields.get('start_at', {}).get('precision', 'datetime'))[0]
    end = date_bounds(details.end_at, details.fields.get('end_at', {}).get('precision', 'datetime'))[1] if details.end_at else start + timedelta(days=1)
    if now < start:
        return 'upcoming'
    return 'ongoing' if now < end else 'ended'


def _read_details(session, contest):
    details = session.get(ContestDetails, contest.id)
    if details is not None:
        return details
    # A read must not silently create rows in a legacy/incomplete database.
    return SimpleNamespace(**{name: getattr(contest, name) for name in (
        'cover_url', 'summary', 'start_at', 'end_at', 'next_deadline', 'mode', 'city', 'fields',
    )}, introduction=None, documents=[], coverage={}, themes=[], theme_sources=[])


_THEME_NAMES = {
    'Machine Learning/AI', 'Beginner Friendly', 'Social Good', 'Open Ended', 'Education',
    'Design', 'Health', 'Gaming', 'Blockchain', 'Productivity', 'Low/No Code', 'Fintech',
    'Cybersecurity', 'Communication', 'Databases', 'Enterprise', 'Music/Art', 'Mobile',
    'Robotic Process Automation', 'Quantum', 'E-commerce/Retail', 'Lifehacks',
    'AI', 'Web', 'AR/VR', 'IoT', 'DevOps', 'Serverless',
}


def _theme_projection(details, fields):
    if details.themes:
        return details.themes, [Source.model_validate(item) for item in details.theme_sources]
    header = (details.summary or '').split('\n')[0].strip()
    header = re.sub(r'^(?:主题|Themes?)\s*[:：]\s*', '', header, flags=re.I)
    themes = [part.strip() for part in re.split(r'[,，、|]', header) if part.strip()]
    if not themes or not all(theme in _THEME_NAMES for theme in themes):
        return [], []
    pages = {source.url: source for field in fields.values() for source in field.sources
             if (urlsplit(source.url).hostname or '').endswith('.devpost.com')}
    if not pages:
        return [], []
    return themes, [source.model_copy(update={'value': '、'.join(themes), 'excerpt': header})
                    for source in pages.values()]


def _coverage(details, fields, introduction):
    coverage = ContentCoverage.model_validate(details.coverage or {})
    for field, value in fields.items():
        observation = coverage.fields.get(field, CoverageObservation())
        if value.value is not None or value.sources or observation.state == 'conflict':
            state = 'conflict' if value.level == 'conflict' else 'found' if value.sources else 'not_fetched'
            observation = observation.model_copy(update={'state': state,
                'urls': list(dict.fromkeys([*observation.urls, *(source.url for source in value.sources)]))})
        coverage.fields[field] = observation
    if introduction is not None:
        coverage.introduction = coverage.introduction.model_copy(update={
            'state': 'found', 'citations': introduction.citations,
            'urls': list(dict.fromkeys(citation.url for citation in introduction.citations)),
        })
    return coverage


def _summary(session, contest, now):
    details = _read_details(session, contest)
    fields = _fields(session, contest.id)
    introduction = ContestIntroduction.model_validate(details.introduction) if details.introduction else None
    themes, theme_sources = _theme_projection(details, fields)
    return ContestSummary(id=contest.id, name=contest.name, cover_url=details.cover_url,
        status=_status(contest, details, now), fields=fields, introduction=introduction,
        coverage=_coverage(details, fields, introduction), themes=themes, theme_sources=theme_sources)


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


_publish_events = ContextVar('publish_contest_events', default=True)


@contextmanager
def event_publication(enabled):
    token = _publish_events.set(enabled)
    try:
        yield
    finally:
        _publish_events.reset(token)


def _version(session, contest):
    details = _details(session, contest)
    evidence = _fields(session, contest.id)
    facts = {key: {part: value.get(part) for part in ('value', 'precision', 'level')}
             for key, value in details.fields.items()}
    for key, value in evidence.items():
        facts.setdefault(key, {})['alternatives'] = sorted({(source.value, source.precision) for source in value.sources})
    return sha256(json.dumps([contest.name, details.summary, details.cover_url, facts], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(session: Session, draft: ContestDraft, *, contest_id: str | None = None, commit: bool = True) -> str:
    for document in draft.documents:
        validate_document(document)
    if draft.introduction is not None:
        validate_introduction(draft.introduction, draft.documents)
    # Acquire SQLite's writer lock before observing the previous facts. A no-op
    # write also works inside callers' existing transactions and commit=False.
    session.flush()
    if session.get_bind().dialect.name == 'sqlite':
        session.connection().exec_driver_sql('UPDATE contests SET id = id WHERE 0')
    # Expire only after flushing pending work. Reused sessions must not supply
    # stale page authority or fact identities to the historical before image.
    session.expire_all()
    page = session.scalar(select(ContestPage).where(ContestPage.url == draft.page.url))
    contest = session.get(Contest, contest_id) if contest_id else _match(session, draft, page)
    if contest_id and contest is None:
        raise ValueError('赛事不存在')
    created = contest is None
    previous_page = (page.site, page.title, page.published_at, page.is_official) if page else None
    previous_claims = {(row.field, row.value, row.excerpt, row.precision) for row in session.scalars(
        select(ContestClaim).where(ContestClaim.contest_id == contest.id, ContestClaim.page_id == page.id))} if page and contest else set()
    if contest is None:
        contest = Contest(id=str(uuid4()), name=draft.name, normalized_name=_normalized_name(draft.name))
        session.add(contest)
    affected = set(session.scalars(select(ContestPageLink.contest_id).where(ContestPageLink.page_id == page.id))) if page else set()
    before = {key: _version(session, session.get(Contest, key)) for key in affected | {contest.id} if not (created and key == contest.id)}
    before_snapshots = {key: ContestSnapshot(name=session.get(Contest, key).name,
        fields=_fields(session, key)).model_dump(mode='json') for key in before}
    details = _details(session, contest)
    if draft.field_resolutions:
        details.fields = {**details.fields, **{field: {
            **details.fields.get(field, {}), 'resolution': decision.model_dump()}
            for field, decision in draft.field_resolutions.items()}}
    documents = {document_key(item): item for item in (details.documents or [])}
    for item in draft.documents:
        previous = documents.get(document_key(item))
        if previous and datetime.fromisoformat(previous['retrieved_at']) > item.retrieved_at:
            continue
        documents[document_key(item)] = item.model_dump(mode='json')
    details.documents = list(documents.values())
    introduction = draft.introduction or next((intro for doc in draft.documents
                                               if (intro := build_introduction(doc)) is not None), None)
    if introduction is not None:
        details.introduction = introduction.model_dump(mode='json')
    coverage = ContentCoverage.model_validate(details.coverage or {})
    coverage.fields.update(draft.coverage.fields)
    coverage.sources.update(draft.coverage.sources)
    if draft.coverage.introduction.state != 'not_fetched':
        coverage.introduction = draft.coverage.introduction
    details.coverage = coverage.model_dump(mode='json')
    if draft.themes is not None:
        theme_sources = [source for source in (details.theme_sources or []) if source['url'] != draft.page.url]
        labels = list(dict.fromkeys(draft.themes))
        if labels:
            theme_sources.append(Source(**draft.page.model_dump(), value='、'.join(labels),
                excerpt='、'.join(labels)).model_dump(mode='json'))
        details.theme_sources = theme_sources
        details.themes = list(dict.fromkeys(label for source in theme_sources for label in source['value'].split('、')))
    if draft.cover_url is not None:
        details.cover_url = draft.cover_url
    if draft.summary is not None:
        details.summary = draft.summary
    if page is None:
        page = ContestPage(id=str(uuid4()), url=draft.page.url)
        session.add(page)
    page.site, page.title, page.is_official = draft.page.site, draft.page.title, draft.page.is_official
    page.host = (urlsplit(page.url).hostname or '').lower().rstrip('.')
    page.published_at = utc_iso(draft.page.published_at.isoformat()) if draft.page.published_at else None
    session.flush()
    link = session.get(ContestPageLink, (contest.id, page.id))
    if link is None:
        link = ContestPageLink(contest_id=contest.id, page_id=page.id)
        session.add(link)
    # Count every apply for concurrency protection, even when facts are equal.
    link.revision = (link.revision or 0) + 1
    affected = set(session.scalars(select(ContestPageLink.contest_id).where(ContestPageLink.page_id == page.id)))
    session.execute(delete(ContestClaim).where(ContestClaim.contest_id == contest.id, ContestClaim.page_id == page.id))
    unique_claims = {}
    for claim in draft.claims:
        key = (claim.field, claim.value)
        previous = unique_claims.get(key)
        if previous and claim.field in DATE_FIELDS and previous.precision == 'datetime' and claim.precision == 'day':
            continue
        unique_claims[key] = claim
    claims = list(unique_claims.values())
    # A more precise same-day assertion supersedes its own sorting anchor, not a contradictory instant.
    claims = [claim for claim in claims if not (claim.field in DATE_FIELDS and claim.precision == 'day'
        and any(other.field == claim.field and other.precision == 'datetime'
                and calendar_date(other.value, other.precision) == calendar_date(claim.value, 'day')
                for other in claims))]
    current_page = (page.site, page.title, page.published_at, page.is_official)
    if previous_page != current_page or previous_claims != {(item.field, item.value, item.excerpt, item.precision) for item in claims}:
        link.verified_content_hash = link.verified_extractor_version = None
    for claim in claims:
        session.add(ContestClaim(contest_id=contest.id, page_id=page.id, **claim.model_dump()))
    session.flush()
    for contest_id in affected | {contest.id}:
        current = session.get(Contest, contest_id)
        _refresh(session, current, _now())
        version = _version(session, current)
        if _publish_events.get() and version != before.get(contest_id):
            session.add(ContestEvent(contest_id=contest_id, kind='created' if created and contest_id == contest.id else 'updated', version=version, occurred_at=_now(),
                before_snapshot=before_snapshots.get(contest_id),
                after_snapshot=ContestSnapshot(name=current.name, fields=_fields(session, contest_id)).model_dump(mode='json')))
    if commit:
        session.commit()
    else:
        session.flush()
    return contest.id


def _sql_deadline_available(field, now):
    upper = getattr(ContestDetails, f'{field}_upper')
    precision = ContestDetails.fields[field]['precision'].as_string()
    return or_(upper > now, and_(upper == now, func.coalesce(precision, 'datetime') != 'day'))


def _query_statement(session: Session, q: ContestQuery, *, attendable=False, blocked_domains=()):
    now = _now()
    instant = _instant(now)
    details = ContestDetails
    # 合并三个仍开放的截止，再按原始 value 取最小值，保持既有名片和 HTTP 排序。
    candidates = union_all(*(select(details.contest_id, details.fields[field]['value'].as_string().label('value'))
        .where(_sql_deadline_available(field, instant)) for field in DEADLINE_FIELDS)).subquery()
    deadlines = select(candidates.c.contest_id, func.min(candidates.c.value).label('value')).group_by(
        candidates.c.contest_id).subquery()
    statement = select(Contest).outerjoin(details, details.contest_id == Contest.id).outerjoin(
        deadlines, deadlines.c.contest_id == Contest.id)
    known_deadlines = or_(*(getattr(details, f'{field}_upper').is_not(None) for field in DEADLINE_FIELDS))
    status = case(
        (details.start_at_lower.is_(None), case(
            (details.end_at_upper <= instant, 'ended'),
            (and_(known_deadlines, deadlines.c.value.is_(None)), 'ended'), else_='upcoming')),
        (details.start_at_lower > instant, 'upcoming'),
        (func.coalesce(details.end_at_upper, details.start_at_lower + 86_400_000_000) > instant, 'ongoing'),
        else_='ended')
    if q.ids is not None:
        statement = statement.where(Contest.id.in_(q.ids))
    if q.keyword:
        keyword = q.keyword.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        statement = statement.where(details.contest_id.is_not(None), or_(
            Contest.name.ilike(f'%{keyword}%', escape='\\'),
            details.summary.ilike(f'%{keyword}%', escape='\\'),
            details.city.ilike(f'%{keyword}%', escape='\\')))
    if q.mode:
        statement = statement.where(details.mode == q.mode)
    if q.status:
        statement = statement.where(status == q.status)
    if attendable:
        statement = statement.where(status != 'ended', *(or_(getattr(details, f'{field}_upper').is_(None),
            _sql_deadline_available(field, instant)) for field in DEADLINE_FIELDS))
    if blocked_domains:
        blocked = or_(*(or_(ContestPage.host == domain, ContestPage.host.endswith('.' + domain, autoescape=True))
                        for domain in blocked_domains))
        statement = statement.where(~exists(select(1).select_from(ContestClaim).join(ContestPage).where(
            ContestClaim.contest_id == Contest.id, blocked)))
    if q.date_from or q.date_to:
        windows = []
        for field in DATE_FIELDS:
            lower, upper = getattr(details, f'{field}_lower'), getattr(details, f'{field}_upper')
            conditions = [lower.is_not(None)]
            if q.date_from:
                boundary = _instant(q.date_from)
                conditions.append(or_(upper > boundary, and_(upper == boundary,
                    func.coalesce(details.fields[field]['precision'].as_string(), 'datetime') != 'day')))
            if q.date_to:
                conditions.append(lower <= _instant(q.date_to))
            windows.append(and_(*conditions))
        statement = statement.where(or_(*windows))
    start = case((details.contest_id.is_not(None), details.start_at), else_=Contest.start_at)
    value = start if q.sort == 'start' else deadlines.c.value
    # Python 原先按 Unicode 码点比较；PG 的语言排序规则不能改变同时间赛事的先后。
    collation = 'C' if session.get_bind().dialect.name == 'postgresql' else 'BINARY'
    return statement.order_by(value.is_(None), func.coalesce(value, '').collate(collation),
        func.coalesce(start, '').collate(collation), Contest.name.collate(collation), Contest.id.collate(collation)
        )


def candidate_query(session: Session, q: ContestQuery, *, attendable=False, blocked_domains=()):
    """SQL-only candidate IDs share the same filters as paginated sourced results."""
    return _query_statement(session, q, attendable=attendable, blocked_domains=blocked_domains).with_only_columns(Contest.id)


def query(session: Session, q: ContestQuery, *, attendable=False, blocked_domains=()) -> tuple[list[ContestSummary], int]:
    statement = _query_statement(session, q, attendable=attendable, blocked_domains=blocked_domains)
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    page = statement.limit(q.page_size).offset((q.page - 1) * q.page_size)
    now = _now()
    return [_summary(session, contest, now) for contest in session.scalars(page)], total


def get(session: Session, contest_id: str) -> ContestDetail | None:
    contest = session.get(Contest, contest_id)
    if contest is None:
        return None
    details = _read_details(session, contest)
    summary = _summary(session, contest, _now())
    documents = []
    for raw in details.documents or []:
        document = ContestDocument.model_validate(raw)
        excerpts = [citation.excerpt for citation in (summary.introduction.citations if summary.introduction else [])
                    if citation.url == document.url and citation.content_hash == document.content_hash]
        excerpts.extend(source.excerpt for value in summary.fields.values() for source in value.sources
                        if source.url == document.url and normalized_text(source.excerpt)
                        and normalized_text(source.excerpt) in normalized_text(document.body))
        documents.append(public_document(document, excerpts))
    return ContestDetail(**(summary.model_dump() | {'summary': details.summary, 'documents': documents}))
