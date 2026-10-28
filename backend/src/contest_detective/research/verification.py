import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from inspect import iscoroutinefunction
from urllib.parse import urlsplit

from pydantic import BaseModel, Field
from sqlalchemy import select

from contest_detective.framework.db import SessionLocal
from contest_detective.contest.models import Contest, ContestDetails, ContestPage, ContestPageLink
from contest_detective.contest.schemas import DEADLINE_FIELDS, date_bounds

from .official import is_official_page
from .detail import EXTRACTOR_VERSION, document_for
from contest_detective.contest.schemas import PageIn
from .refresh.contracts import RefreshFailure
from .verification_contracts import PageCheck

logger = logging.getLogger(__name__)


class VerificationReport(BaseModel):
    attempted: int = 0
    verified: int = 0
    unchanged: int = 0
    failed: int = 0
    failures: list[RefreshFailure] = Field(default_factory=list)
    checks: list[PageCheck] = Field(default_factory=list)


@dataclass(frozen=True)
class _Target:
    contest_id: str
    url: str
    order: tuple


def _bounds(value):
    return date_bounds(value['value'], value.get('precision', 'datetime')) if value.get('value') else None


def _pending(bounds, now):
    if bounds is None:
        return False
    start, end = bounds
    # 全天日期的结束不包含在内；精确时刻在边界当刻仍可核对。
    return end > now if start != end else end >= now


def _targets(session, now, limit, *, contest_ids=None):
    statement = select(Contest, ContestDetails).join(ContestDetails, ContestDetails.contest_id == Contest.id)
    if contest_ids is not None:
        statement = statement.where(Contest.id.in_(contest_ids))
    candidates = []
    for contest, details in session.execute(statement):
        values = {key: item.get('value') for key, item in details.fields.items()}
        dates = [_bounds(details.fields.get(key, {})) for key in (*DEADLINE_FIELDS, 'start_at')]
        end = _bounds(details.fields.get('end_at', {}))
        if contest_ids is None and end is not None and not _pending(end, now):
            continue
        url = values.get('registration_url')
        if not url or not is_official_page(url, registration_url=url):
            continue
        deadlines = [bounds[0] for bounds in dates[:-1] if _pending(bounds, now)]
        deadline = min(deadlines) if deadlines else None
        start = dates[-1][0] if dates[-1] is not None else None
        candidates.append(_Target(contest.id, url,
            (deadline is None, deadline or start or now, url, contest.id)))
    result, seen = [], set()
    for target in sorted(candidates, key=lambda item: item.order):
        if contest_ids is not None or target.url not in seen:
            result.append(target)
            seen.add(target.url)
        if len(result) >= limit:
            break
    return result


async def verify_recent(*, extractor, session_factory=SessionLocal, fetcher=None, runner=None,
                        now=None, limit=30, extractor_version=EXTRACTOR_VERSION, contest_ids=None, clock=None,
                        normalizer=None) -> VerificationReport:
    """按批次核对未明确结束的赛事，只缓存成功写回的正文。"""
    report = VerificationReport()
    clock = clock or (lambda: datetime.now(timezone.utc))
    if limit <= 0:
        return report
    if fetcher is None:
        from .pages import fetch_page
        fetcher = fetch_page
    default_runner = runner is None
    if default_runner:
        from contest_detective.research.record import run
        runner = run
    now = now or datetime.now(timezone.utc)
    with session_factory() as session:
        eligible = _targets(session, now, max(len(contest_ids), 1) if contest_ids is not None else limit, contest_ids=contest_ids)
        targets = eligible[:limit]
        page_versions, revisions = {}, {}
        for target in targets:
            link = session.scalar(select(ContestPageLink).join(ContestPage, ContestPage.id == ContestPageLink.page_id)
                .where(ContestPageLink.contest_id == target.contest_id, ContestPage.url == target.url))
            revisions[target.contest_id] = link.revision if link else 0
            page = session.get(ContestPage, link.page_id) if link else None
            page_versions[target.contest_id] = (link.verified_content_hash, link.verified_extractor_version) if page and page.is_official else None
        from contest_detective.contest.service import _version
        previous = {target.contest_id: _version(session, session.get(Contest, target.contest_id)) for target in targets}
    if contest_ids is not None:
        found = {target.contest_id for target in eligible}
        for contest_id in dict.fromkeys(contest_ids):
            if contest_id not in found:
                observed = clock()
                report.checks.append(PageCheck(contest_id=contest_id, checked_at=observed,
                    completed_at=observed, outcome='no_source'))
    bodies, observed_at = {}, {}
    for target in targets:
        report.attempted += 1
        stage = 'fetch'
        checked_at = clock()
        try:
            if target.url not in bodies:
                observed_at[target.url] = checked_at
                try:
                    bodies[target.url] = await fetcher(target.url) if iscoroutinefunction(fetcher) else await asyncio.to_thread(fetcher, target.url)
                except Exception as exc:
                    bodies[target.url] = exc
            checked_at = observed_at[target.url]
            body = bodies[target.url]
            if isinstance(body, Exception):
                raise body
            if not body or not body.strip():
                raise ValueError('页面正文为空')
            digest = sha256(body.encode('utf-8')).hexdigest()
            with session_factory() as session:
                current_link = session.scalar(select(ContestPageLink).join(ContestPage, ContestPage.id == ContestPageLink.page_id)
                    .where(ContestPageLink.contest_id == target.contest_id, ContestPage.url == target.url, ContestPage.is_official.is_(True)))
                cache_current = current_link is not None and current_link.revision == revisions[target.contest_id] and (
                    current_link.verified_content_hash, current_link.verified_extractor_version) == (digest, extractor_version)
            if page_versions[target.contest_id] == (digest, extractor_version) and cache_current:
                report.unchanged += 1
                report.checks.append(PageCheck(contest_id=target.contest_id, checked_at=checked_at,
                    completed_at=clock(), outcome='unchanged', source_url=target.url))
                logger.info('Page verification skipped contest_id=%s reason=unchanged_body', target.contest_id)
                continue
            stage = 'extract'
            kwargs = {}
            if default_runner:
                page = PageIn(url=target.url, site=urlsplit(target.url).hostname or '',
                    title=target.url, is_official=True)
                kwargs['document'] = document_for(page, body, now=now).model_copy(update={
                    'extractor_version': extractor_version})
                kwargs['normalizer'] = normalizer
            saved_id = await runner(target.url, extractor=extractor, session_factory=session_factory,
                page_text=body, registration_url=target.url, contest_id=target.contest_id, **kwargs)
            stage = 'persist'
            if saved_id != target.contest_id:
                raise ValueError('核对结果没有写回赛事')
            with session_factory() as session:
                session.connection().exec_driver_sql('UPDATE contests SET id = id WHERE 0')
                page = session.scalar(select(ContestPage).where(ContestPage.url == target.url))
                if page is None or not page.is_official:
                    raise ValueError('核对结果缺少官方页面')
                link = session.get(ContestPageLink, (target.contest_id, page.id))
                if link is None:
                    raise ValueError('核对结果缺少赛事页面关联')
                if link.revision != revisions[target.contest_id] + 1:
                    raise RuntimeError('核对期间赛事被其他更新覆盖，需重新核对')
                link.verified_content_hash = digest
                link.verified_extractor_version = extractor_version
                page.content_hash = digest
                page.extractor_version = extractor_version
                session.commit()
            with session_factory() as session:
                changed = previous[target.contest_id] != _version(session, session.get(Contest, target.contest_id))
            report.checks.append(PageCheck(contest_id=target.contest_id, checked_at=checked_at,
                completed_at=clock(), outcome='changed' if changed else 'unchanged', source_url=target.url))
            report.verified += 1
            logger.info('Page verification completed contest_id=%s', target.contest_id)
        except Exception as exc:
            # 单个官网超时或无可证字段，下轮仍重试，不缓存失败正文。
            report.failed += 1
            report.checks.append(PageCheck(contest_id=target.contest_id, checked_at=checked_at,
                completed_at=clock(), outcome='failed', source_url=target.url, error_type=type(exc).__name__))
            report.failures.append(RefreshFailure(key=target.contest_id, stage=stage,
                url=target.url, reason=type(exc).__name__))
            logger.warning('Page verification failed contest_id=%s error_type=%s',
                           target.contest_id, type(exc).__name__)
    return report
