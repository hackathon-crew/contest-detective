import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from inspect import iscoroutinefunction

from pydantic import BaseModel
from sqlalchemy import select

from contest_detective.framework.db import SessionLocal
from contest_detective.server.contest.models import Contest, ContestDetails, ContestPage
from contest_detective.server.contest.schemas import DEADLINE_FIELDS, date_bounds

from .official import is_official_page

logger = logging.getLogger(__name__)


class VerificationReport(BaseModel):
    attempted: int = 0
    verified: int = 0
    unchanged: int = 0
    failed: int = 0


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


def _targets(session, now, limit):
    statement = select(Contest, ContestDetails).join(ContestDetails, ContestDetails.contest_id == Contest.id)
    candidates = []
    for contest, details in session.execute(statement):
        values = {key: item.get('value') for key, item in details.fields.items()}
        dates = [_bounds(details.fields.get(key, {})) for key in (*DEADLINE_FIELDS, 'start_at')]
        end = _bounds(details.fields.get('end_at', {}))
        if end is not None and not _pending(end, now):
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
        if target.url not in seen:
            result.append(target)
            seen.add(target.url)
        if len(result) >= limit:
            break
    return result


async def verify_recent(*, extractor, session_factory=SessionLocal, fetcher=None, runner=None,
                        now=None, limit=30) -> VerificationReport:
    """按批次核对未明确结束的赛事，只缓存成功写回的正文。"""
    report = VerificationReport()
    if limit <= 0:
        return report
    if fetcher is None:
        from .pages import fetch_page
        fetcher = fetch_page
    if runner is None:
        from contest_detective.server.research_pipeline.record import run
        runner = run
    now = now or datetime.now(timezone.utc)
    with session_factory() as session:
        targets = _targets(session, now, limit)
    for target in targets:
        report.attempted += 1
        try:
            body = await fetcher(target.url) if iscoroutinefunction(fetcher) else await asyncio.to_thread(fetcher, target.url)
            if not body or not body.strip():
                raise ValueError('页面正文为空')
            digest = sha256(body.encode('utf-8')).hexdigest()
            with session_factory() as session:
                page = session.scalar(select(ContestPage).where(ContestPage.url == target.url))
                if page is not None and page.is_official and page.content_hash == digest:
                    report.unchanged += 1
                    logger.info('Page verification skipped contest_id=%s reason=unchanged_body', target.contest_id)
                    continue
            saved_id = await runner(target.url, extractor=extractor, session_factory=session_factory,
                page_text=body, registration_url=target.url, contest_id=target.contest_id)
            if saved_id != target.contest_id:
                raise ValueError('核对结果没有写回赛事')
            with session_factory() as session:
                page = session.scalar(select(ContestPage).where(ContestPage.url == target.url))
                if page is None or not page.is_official:
                    raise ValueError('核对结果缺少官方页面')
                page.content_hash = digest
                session.commit()
            report.verified += 1
            logger.info('Page verification completed contest_id=%s', target.contest_id)
        except Exception as exc:
            # 单个官网超时或无可证字段，下轮仍重试，不缓存失败正文。
            report.failed += 1
            logger.warning('Page verification failed contest_id=%s error_type=%s',
                           target.contest_id, type(exc).__name__)
    return report
