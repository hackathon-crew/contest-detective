"""Opt-in check scheduling. Disabled by default and independent of source autosync."""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from contest_detective.system.account.models import Follow
from contest_detective.research.verification import verify_recent
from contest_detective.system.user.models import User

from .config import get_watch_settings
from .models import Check, Subscription
from .service import consume, utc


def due_contests(session, now, *, interval_minutes, limit):
    subscriptions = select(Subscription.contest_id).join(User, User.id == Subscription.user_id).join(
        Follow, (Follow.user_id == Subscription.user_id) & (Follow.contest_id == Subscription.contest_id)).where(
        Subscription.enabled.is_(True), User.is_active.is_(True)).distinct()
    candidates = []
    for contest_id in session.scalars(subscriptions):
        check = session.get(Check, contest_id)
        checked = utc(check.completed_at) if check else None
        if checked is None or checked + timedelta(minutes=interval_minutes) <= now:
            candidates.append((checked is not None, checked or now, contest_id))
    return [row[2] for row in sorted(candidates)[:limit]]


async def run_due(factory, *, extractor, config=None, now=None, fetcher=None, runner=None, clock=None):
    config = config or get_watch_settings()
    if not config.watch_enabled:
        return []
    now = now or datetime.now(timezone.utc)
    with factory() as session:
        ids = due_contests(session, now, interval_minutes=config.watch_interval_minutes, limit=config.watch_batch_size)
    if not ids:
        return []
    report = await verify_recent(session_factory=factory, extractor=extractor, now=now,
        limit=len(ids), contest_ids=ids, fetcher=fetcher, runner=runner, clock=clock)
    with factory() as session:
        for observed in report.checks:
            row = session.get(Check, observed.contest_id)
            if row is None:
                row = Check(contest_id=observed.contest_id)
                session.add(row)
            # A slower overlapping check must not replace a newer observation.
            if row.completed_at is not None and utc(row.completed_at) > observed.completed_at:
                continue
            for field in ('checked_at', 'completed_at', 'outcome', 'source_url', 'error_type'):
                setattr(row, field, getattr(observed, field))
            if observed.outcome in ('changed', 'unchanged'):
                row.last_success_at = observed.completed_at
        session.commit()
        users = list(session.scalars(select(Subscription.user_id).where(Subscription.enabled.is_(True)).distinct()))
    for user_id in users:
        consume(factory, user_id)
    return report.checks


def start_watch_scheduler(factory, *, extractor_factory):
    config = get_watch_settings()
    if not config.watch_enabled:
        return None
    from apscheduler.schedulers.background import BackgroundScheduler
    scheduler = BackgroundScheduler(timezone=timezone.utc)
    extractor = extractor_factory()
    scheduler.add_job(lambda: asyncio.run(run_due(factory, extractor=extractor, config=config)),
        'interval', seconds=60, id='private-contest-watch', next_run_time=datetime.now(timezone.utc),
        max_instances=1, coalesce=True)
    scheduler.start()
    return scheduler
