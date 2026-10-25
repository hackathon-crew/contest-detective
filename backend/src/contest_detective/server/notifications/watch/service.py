"""Account-owned in-app events. No mail cursor, fingerprint, or delivery access."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert

from contest_detective.common.exceptions import BizException
from contest_detective.server.account.models import Follow
from contest_detective.server.contest.events import ContestChange
from contest_detective.server.contest.models import Contest, ContestEvent
from contest_detective.server.research_pipeline.verification_contracts import PageCheck
from contest_detective.server.user.models import User

from .config import get_watch_settings
from .contracts import WatchStatus
from .models import Check, Cursor, Notification, Subscription


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


class StatusRead(WatchStatus):
    contest_name: str


class NotificationRead(BaseModel):
    event_id: int
    contest_id: str
    occurred_at: datetime
    change: ContestChange
    read_at: datetime | None = None


class WatchRead(BaseModel):
    items: list[StatusRead]
    notifications: list[NotificationRead]
    has_more: bool = False
    has_more_notifications: bool = False


def set_enabled(session, user_id, contest_id, enabled):
    # The write obtains SQLite's transaction lock before reading the baseline.
    session.execute(insert(Cursor).values(user_id=user_id, event_id=0).on_conflict_do_nothing())
    if session.get(Follow, (user_id, contest_id)) is None:
        raise BizException('请先关注这场比赛', code=404)
    row = session.get(Subscription, (user_id, contest_id))
    if row is None:
        row = Subscription(user_id=user_id, contest_id=contest_id, enabled=False, activated_event_id=0)
        session.add(row)
    if enabled and not row.enabled:
        row.activated_event_id = session.scalar(select(func.max(ContestEvent.id))) or 0
    row.enabled = enabled
    session.commit()
    return row


def consume(factory, user_id, *, limit=500):
    """Serialize each SQLite writer; cursor and unique notifications commit together."""
    if limit < 1:
        return 0
    with factory() as session:
        session.connection().exec_driver_sql('BEGIN IMMEDIATE')
        user = session.get(User, user_id)
        if user is None or not user.is_active:
            return 0
        cursor = session.get(Cursor, user_id)
        if cursor is None:
            cursor = Cursor(user_id=user_id, event_id=0)
            session.add(cursor)
        events = session.scalars(select(ContestEvent).where(ContestEvent.id > cursor.event_id)
            .order_by(ContestEvent.id).limit(limit)).all()
        subscriptions = {row.contest_id: row for row in session.scalars(select(Subscription)
            .join(Follow, (Follow.user_id == Subscription.user_id) & (Follow.contest_id == Subscription.contest_id))
            .where(Subscription.user_id == user_id, Subscription.enabled.is_(True)))}
        for event in events:
            row = subscriptions.get(event.contest_id)
            if (row is None or event.id <= row.activated_event_id or event.kind != 'updated'
                    or event.before_snapshot is None or event.after_snapshot is None):
                continue
            # Validate persisted snapshots but never fabricate history from current facts.
            change = ContestChange(before=event.before_snapshot, after=event.after_snapshot)
            if change.before == change.after:
                continue
            session.execute(insert(Notification).values(user_id=user_id, event_id=event.id)
                .on_conflict_do_nothing())
        if events:
            cursor.event_id = events[-1].id
        session.commit()
        return len(events)


def statuses(session, user_id, *, now=None, config=None):
    config = config or get_watch_settings()
    now = now or datetime.now(timezone.utc)
    rows = session.execute(select(Follow, Contest).join(Contest, Contest.id == Follow.contest_id)
        .where(Follow.user_id == user_id).order_by(Follow.created_at, Follow.contest_id))
    result = []
    for follow, contest in rows:
        subscription = session.get(Subscription, (user_id, contest.id))
        enabled = bool(subscription and subscription.enabled)
        check = session.get(Check, contest.id)
        last_check = PageCheck(contest_id=contest.id, checked_at=utc(check.checked_at),
            completed_at=utc(check.completed_at), outcome=check.outcome,
            source_url=check.source_url, error_type=check.error_type) if check else None
        state = 'paused' if not enabled else 'scheduler_paused' if not config.watch_enabled else (
            'no_source' if check and check.outcome == 'no_source' else 'scheduled')
        next_check = max(now, utc(check.completed_at) + timedelta(minutes=config.watch_interval_minutes)) if check else now
        result.append(StatusRead(contest_id=contest.id, contest_name=contest.name, enabled=enabled,
            state=state, last_check=last_check, last_success_at=utc(check.last_success_at) if check else None,
            next_check_at=next_check if state == 'scheduled' else None))
    return result


def notification_rows(session, user_id, *, before_event_id=None, limit=100):
    statement = select(Notification, ContestEvent).join(ContestEvent, Notification.event_id == ContestEvent.id)
    statement = statement.where(Notification.user_id == user_id)
    if before_event_id is not None:
        statement = statement.where(Notification.event_id < before_event_id)
    rows = session.execute(statement.order_by(Notification.event_id.desc()).limit(limit + 1)).all()
    return [NotificationRead(event_id=event.id, contest_id=event.contest_id,
        occurred_at=utc(event.occurred_at), read_at=utc(notification.read_at),
        change=ContestChange(before=event.before_snapshot, after=event.after_snapshot))
        for notification, event in rows[:limit]], len(rows) > limit


def read(session, user_id, *, before_event_id=None):
    notifications, more = notification_rows(session, user_id, before_event_id=before_event_id)
    cursor = session.get(Cursor, user_id)
    newest = session.scalar(select(func.max(ContestEvent.id))) or 0
    return WatchRead(items=statuses(session, user_id), notifications=notifications,
        has_more=newest > (cursor.event_id if cursor else 0), has_more_notifications=more)


def mark_read(session, user_id, event_id):
    row = session.get(Notification, (user_id, event_id))
    if row is None:
        raise BizException('提醒不存在', code=404)
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        session.commit()


def remove_subscription(session, user_id, contest_id):
    session.execute(delete(Subscription).where(Subscription.user_id == user_id, Subscription.contest_id == contest_id))


def export_data(session, user_id):
    rows = session.scalars(select(Subscription).where(Subscription.user_id == user_id)).all()
    notifications, _ = notification_rows(session, user_id, limit=2**31 - 1)
    cursor = session.get(Cursor, user_id)
    return {'subscriptions': [{'contest_id': row.contest_id, 'enabled': row.enabled,
        'activated_event_id': row.activated_event_id} for row in rows],
        'notifications': [row.model_dump(mode='json') for row in notifications],
        'event_cursor': cursor.event_id if cursor else 0}
