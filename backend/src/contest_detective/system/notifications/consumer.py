from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select

from contest_detective.system.account.models import AccountSettings, Follow, Track
from contest_detective.system.account.schemas import PushSettings, TrackingConditions
from contest_detective.contest import service as contests
from contest_detective.contest.models import ContestEvent
from contest_detective.system.user.models import User
from contest_detective.system.user.schemas import Profile
from contest_detective.system.user.matching import match
from .models import ConsumerCursor, PendingNotification, SeenNotification
from .tracking import matching_contests

BEIJING = ZoneInfo('Asia/Shanghai')


def consume_events(factory, now):
    from .service import fingerprint
    with factory() as session:
        cursor = session.get(ConsumerCursor, 'mail')
        if cursor is None:
            cursor = ConsumerCursor(name='mail', event_id=0)
            session.add(cursor)
        events = session.scalars(select(ContestEvent).where(ContestEvent.id > cursor.event_id,
            ContestEvent.occurred_at <= now).order_by(ContestEvent.id).limit(500)).all()
        if not events: return 0
        latest = {event.contest_id: event for event in events}
        for user in session.scalars(select(User).where(User.is_active.is_(True), User.is_verified.is_(True))):
            preferences = session.get(AccountSettings, user.id)
            if preferences is None: continue
            settings = PushSettings.model_validate(preferences.push or {})
            if not settings.enabled: continue
            local = now.astimezone(BEIJING)
            start = datetime.combine(local.date(), time(), BEIJING)
            if settings.frequency == 'weekly': start -= timedelta(days=local.weekday())
            recent = {key for key, event in latest.items() if event.occurred_at.replace(tzinfo=timezone.utc) >= start}
            reasons = {item.contest.id: item.reason for item in match(session, Profile.model_validate(user.profile or {}), limit=None)
                       if item.contest.id in recent} if settings.new_matches else {}
            tracks = []
            if settings.tracking:
                for track in session.scalars(select(Track).where(Track.user_id == user.id, Track.enabled.is_(True))):
                    ids = {item.id for item in matching_contests(session, TrackingConditions.model_validate(track.conditions), now, user_id=user.id)} & recent
                    tracks.append((track, ids))
            follows = {follow.contest_id: follow for follow in session.scalars(select(Follow).where(Follow.user_id == user.id))}
            for key, event in latest.items():
                item = contests.get(session, key)
                if item is None or item.status == 'ended': continue
                follow = follows.get(key)
                track_ids = [track.id for track, ids in tracks if key in ids]
                reason = 'profile' if key in reasons else 'tracking' if track_ids else None
                seen = session.get(SeenNotification, (user.id, key))
                if seen or follow: reason = None
                if follow:
                    version = fingerprint(item)
                    if settings.changes and follow.reminders and follow.last_fingerprint and follow.last_fingerprint != version:
                        reason = 'change'
                    follow.last_fingerprint = version
                if reason is None: continue
                pending = session.get(PendingNotification, (user.id, key))
                if pending is None:
                    pending = PendingNotification(user_id=user.id, contest_id=key, event_id=event.id,
                        reason=reason, version=event.version, track_ids=track_ids, queued_at=event.occurred_at)
                    session.add(pending)
                else:
                    pending.event_id, pending.version = event.id, event.version
                    pending.track_ids = sorted(set(pending.track_ids) | set(track_ids))
                    if reason == 'change': pending.reason = reason
        cursor.event_id = events[-1].id
        session.commit()
        return len(events)
