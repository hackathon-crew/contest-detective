import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from inspect import iscoroutinefunction

from pydantic import BaseModel
from sqlalchemy import select

from contest_detective.framework.db import SessionLocal
from contest_detective.server.contest.models import Contest, ContestPage, ContestPageLink
from contest_detective.server.contest.schemas import DEADLINE_FIELDS

from .official import is_official_page


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


def _date(value):
    return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None


def _targets(session, now, limit):
    horizon = now + timedelta(days=30)
    statement = select(Contest).join(ContestPageLink).join(
        ContestPage, ContestPage.id == ContestPageLink.page_id).where(~ContestPage.is_official).distinct()
    candidates = []
    for contest in session.scalars(statement):
        values = {key: item.get('value') for key, item in contest.fields.items()}
        dates = [_date(values.get(key)) for key in (*DEADLINE_FIELDS, 'start_at')]
        if not any(date is not None and now <= date <= horizon for date in dates):
            continue
        url = values.get('registration_url')
        if not url or not is_official_page(url, registration_url=url):
            continue
        deadlines = [date for date in dates[:-1] if date is not None and date >= now]
        deadline = min(deadlines) if deadlines else None
        candidates.append(_Target(contest.id, url,
            (deadline is None, deadline or dates[-1] or horizon, url, contest.id)))
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
    """每轮最多读 30 个近期开赛或截止的报名页，只缓存成功写回的正文。"""
    report = VerificationReport()
    if limit <= 0:
        return report
    if fetcher is None:
        from .pages import fetch_page
        fetcher = fetch_page
    if runner is None:
        from .service import run
        runner = run
    now = now or datetime.now(timezone.utc)
    with session_factory() as session:
        targets = _targets(session, now, min(limit, 30))
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
        except Exception:
            # 单个官网超时或无可证字段，下轮仍重试，不缓存失败正文。
            report.failed += 1
    return report
