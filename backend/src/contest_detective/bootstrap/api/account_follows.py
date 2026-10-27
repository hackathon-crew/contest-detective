from fastapi import APIRouter, Depends, Response as HttpResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.framework.db import get_session
from contest_detective.system.auth.service import current
from contest_detective.contest.schemas import ContestDetail
from contest_detective.system.account import follows
from contest_detective.system.notifications.watch.service import remove_subscription
from contest_detective.system.account.models import Follow, AccountSettings
from contest_detective.system.account.schemas import Timestamp
from contest_detective.system.account.store import owner

router = APIRouter()


class FollowRead(BaseModel):
    contest: ContestDetail
    reminders: bool
    created_at: Timestamp


class FollowUpdate(BaseModel):
    reminders: bool | None = None


class FollowMerge(BaseModel):
    ids: list[str] = Field(max_length=10000)


class CalendarRead(BaseModel):
    url: str


def read(row, item):
    return FollowRead(contest=item, reminders=row.reminders, created_at=row.created_at)


def read_all(session, user_id):
    return [read(row, item) for row, item in follows.followed(session, user_id)]


@router.get('/account/follows', response_model=Response[list[FollowRead]])
def list_follows(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    return Response.success(read_all(session, owner(session, user_id).id))


@router.post('/account/follows/merge', response_model=Response[list[FollowRead]])
def merge_follows(body: FollowMerge, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    for contest_id in dict.fromkeys(body.ids):
        try:
            follows.add_follow(session, user.id, contest_id)
        except BizException as exc:
            if exc.code != 404: raise
    session.commit()
    return Response.success(read_all(session, user.id))


@router.put('/account/follows/{contest_id}', response_model=Response[FollowRead])
def follow(contest_id: str, body: FollowUpdate, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    row, item = follows.add_follow(session, owner(session, user_id).id, contest_id, body.reminders)
    session.commit()
    return Response.success(read(row, item))


@router.patch('/account/follows/{contest_id}', response_model=Response[FollowRead])
def update_follow(contest_id: str, body: FollowUpdate, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = owner(session, user_id)
    row = session.get(Follow, (user.id, contest_id))
    if row is None: raise BizException('关注的比赛不存在', code=404)
    if body.reminders is not None: row.reminders = body.reminders
    session.commit()
    return Response.success(read(row, follows.contests.get(session, contest_id)))


@router.delete('/account/follows/{contest_id}', response_model=Response[None])
def unfollow(contest_id: str, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    row = session.get(Follow, (owner(session, user_id).id, contest_id))
    if row is not None:
        remove_subscription(session, row.user_id, contest_id)
        session.delete(row)
        session.commit()
    return Response.success()


@router.get('/account/calendar', response_model=Response[CalendarRead])
def read_calendar(user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    return Response.success(CalendarRead(url=follows.calendar_url(session, owner(session, user_id).id)))


@router.get('/calendar/{secret}.ics', response_class=HttpResponse)
def calendar(secret: str, session: Session = Depends(get_session)):
    settings = session.scalar(select(AccountSettings).where(AccountSettings.calendar_secret == secret)) if 20 <= len(secret) <= 128 else None
    if settings is None: raise BizException('日历订阅不存在', code=404)
    owner(session, str(settings.user_id))
    return HttpResponse(follows.calendar_feed(session, settings.user_id), media_type='text/calendar',
                        headers={'Cache-Control':'private, no-cache, no-store', 'Content-Disposition':'inline; filename="inkpaw.ics"'})
