from typing import Annotated
from datetime import datetime, timedelta, timezone
import uuid
import secrets
import time
from collections import OrderedDict
from threading import RLock

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.orm import Session, sessionmaker

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.framework.db import get_session
from contest_detective.system.account.providers import runtime_for
from contest_detective.system.auth.service import current as query_user
from contest_detective.system.auth.service import current
from contest_detective.agent.llm import create_model
from contest_detective.system.account.models import MailDelivery, Track
from contest_detective.system.account.schemas import MailPreview, MailRead, PushSettings, TrackInput, TrackRead, TrackingConditions, Text, LibraryConditions
from contest_detective.system.account.store import owner, settings_for, verified
from contest_detective.system.notifications.tracking import create_tracking_parser, matching_contests, meaningful
from contest_detective.system.notifications.service import BEIJING, deliver, next_send, preview
from .mail import get_mailer

router = APIRouter()


class PushRead(BaseModel):
    settings: PushSettings
    email: str
    email_verified: bool
    next_send_at: datetime | None = None


class TrackUpdate(BaseModel):
    enabled: bool | None = None
    text: Text | None = None


def get_tracking_parser(session: Session = Depends(get_session), user_id: Annotated[str | None, Depends(query_user)] = None):
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    runtime = runtime_for(session, user_id)
    return create_tracking_parser(lambda: create_model(settings=runtime.llm, session_factory=factory))


def push_read(session, user):
    settings = PushSettings.model_validate(settings_for(session, user.id).push or {})
    return PushRead(settings=settings, email=user.email, email_verified=user.is_verified,
                    next_send_at=next_send(settings, datetime.now(timezone.utc)))


@router.get('/account/push', response_model=Response[PushRead])
def read_push(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    return Response.success(push_read(session, owner(session, user_id)))


@router.put('/account/push', response_model=Response[PushRead])
def save_push(body: PushSettings, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    if body.enabled: verified(user)
    row = settings_for(session, user.id)
    row.push = {**(row.push or {}), **body.model_dump(mode='json')}
    if not body.enabled:
        from contest_detective.system.notifications.models import PendingNotification
        session.execute(delete(PendingNotification).where(PendingNotification.user_id == user.id))
    session.commit()
    return Response.success(push_read(session, user))


def track_read(session, track):
    conditions = TrackingConditions.model_validate(track.conditions)
    return TrackRead(id=track.id, text=track.text, conditions=conditions, enabled=track.enabled,
                     matched_count=len(matching_contests(session, conditions, user_id=track.user_id)), last_sent_at=track.last_sent_at)


@router.get('/account/tracks', response_model=Response[list[TrackRead]])
def read_tracks(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    return Response.success([track_read(session, track) for track in session.scalars(select(Track).where(Track.user_id == user.id).order_by(Track.created_at))])


@router.post('/account/tracks', response_model=Response[TrackRead])
async def create_track(body: TrackInput, user_id: str | None = Depends(current), session: Session = Depends(get_session), parser=Depends(get_tracking_parser)):
    user = owner(session, user_id)
    conditions = meaningful(await parser(body.text, datetime.now(BEIJING).date()))
    track = Track(user_id=user.id, text=body.text, conditions=conditions.model_dump(mode='json'))
    session.add(track)
    session.commit()
    return Response.success(track_read(session, track))


class LibraryTrackInput(BaseModel):
    text: Text
    filters: LibraryConditions


@router.post('/account/tracks/filters', response_model=Response[TrackRead])
def track_filters(body: LibraryTrackInput, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    conditions = meaningful(TrackingConditions(library=body.filters))
    track = Track(user_id=user.id, text=body.text, conditions=conditions.model_dump(mode='json'))
    session.add(track)
    session.commit()
    return Response.success(track_read(session, track))


@router.patch('/account/tracks/{track_id}', response_model=Response[TrackRead])
async def update_track(track_id: str, body: TrackUpdate, user_id: str | None = Depends(current), session: Session = Depends(get_session), parser=Depends(get_tracking_parser)):
    user = owner(session, user_id)
    track = session.get(Track, track_id)
    if track is None or track.user_id != user.id: raise BizException('追踪条件不存在', code=404)
    if body.text is not None:
        track.conditions = meaningful(await parser(body.text, datetime.now(BEIJING).date())).model_dump(mode='json')
        track.text, track.seen_contests = body.text, []
    if body.enabled is not None: track.enabled = body.enabled
    session.commit()
    return Response.success(track_read(session, track))


class UndoReceipt(BaseModel):
    undo_token: str


_deleted = OrderedDict()
_deleted_lock = RLock()


@router.delete('/account/tracks/{track_id}', response_model=Response[UndoReceipt])
def delete_track(track_id: str, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    track = session.get(Track, track_id)
    if track is None or track.user_id != user.id: raise BizException('追踪条件不存在', code=404)
    snapshot = {column.name: getattr(track, column.name) for column in Track.__table__.columns}
    session.delete(track)
    session.commit()
    receipt = secrets.token_urlsafe(24)
    with _deleted_lock:
        while _deleted and (next(iter(_deleted.values()))[0] < time.monotonic() or len(_deleted) >= 1000):
            _deleted.popitem(last=False)
        _deleted[receipt] = (time.monotonic()+30, user.id, snapshot)
    return Response.success(UndoReceipt(undo_token=receipt))


@router.post('/account/tracks/restore', response_model=Response[TrackRead])
def restore_track(body: UndoReceipt, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    with _deleted_lock:
        saved = _deleted.get(body.undo_token)
        if saved is None or saved[0] < time.monotonic() or saved[1] != user.id:
            raise BizException('撤销已过期，请重新添加追踪条件', code=404)
        track = Track(**saved[2])
        session.add(track)
        session.commit()
        del _deleted[body.undo_token]
    return Response.success(track_read(session, track))


class TrackMatches(BaseModel):
    ids: list[str]
    text: str
    conditions: TrackingConditions


@router.get('/account/tracks/{track_id}/matches', response_model=Response[TrackMatches])
def track_matches(track_id: str, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    track = session.get(Track, track_id)
    if track is None or track.user_id != user.id: raise BizException('追踪条件不存在', code=404)
    conditions = TrackingConditions.model_validate(track.conditions)
    return Response.success(TrackMatches(ids=[item.id for item in matching_contests(session, conditions, user_id=track.user_id)], text=track.text, conditions=conditions))


@router.get('/account/push/preview', response_model=Response[MailPreview])
def preview_mail(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    return Response.success(preview(session, owner(session, user_id)))


@router.post('/account/push/test', response_model=Response[None])
def test_mail(user_id: str | None = Depends(current), session: Session = Depends(get_session), mailer=Depends(get_mailer)):
    user = owner(session, user_id)
    verified(user)
    now = datetime.now(timezone.utc)
    deliver(session, user, mailer, preview(session, user, now), key='test:'+str(uuid.uuid4()), kind='test', now=now)
    return Response.success()


@router.get('/account/push/history', response_model=Response[list[MailRead]])
def read_history(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    rows = session.scalars(select(MailDelivery).where(MailDelivery.user_id == user.id,
        MailDelivery.created_at >= datetime.now(timezone.utc)-timedelta(days=30)).order_by(MailDelivery.created_at.desc()))
    return Response.success([MailRead.model_validate({name: getattr(row, name) for name in MailRead.model_fields}) for row in rows])


@router.post('/notifications/resend', response_model=Response[None])
async def mail_receipt(request: Request, session: Session = Depends(get_session)):
    from contest_detective.system.notifications.config import get_account_runtime_settings
    from contest_detective.system.notifications.resend import verify_webhook
    secret = get_account_runtime_settings().resend_webhook_secret.get_secret_value()
    if not secret: raise BizException('邮件回执还没有配置', code=503)
    body = await request.body()
    if len(body) > 262144: raise BizException('回执过大', code=413)
    event = verify_webhook(body, request.headers, secret)
    identifier = event.get('data', {}).get('email_id')
    row = session.scalar(select(MailDelivery).where(MailDelivery.provider_id == identifier)) if identifier else None
    if row is not None:
        status = {'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.failed': 'failed', 'email.complained': 'bounced'}.get(event.get('type'))
        if status and (row.status != 'bounced' or status == 'bounced'):
            row.status = status
            row.retry_at = None
            if status == 'bounced':
                row.attempts = 5
                user = owner(session, str(row.user_id))
                if user.email == row.recipient:
                    settings = settings_for(session, user.id)
                    settings.push = {**settings.push, 'enabled': False}
            session.commit()
    return Response.success()
