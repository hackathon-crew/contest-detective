from fastapi import APIRouter, Depends, Query, Response as HttpResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

from contest_detective.common.result import Response
from contest_detective.framework.db import get_session
from contest_detective.server.account.store import owner
from contest_detective.server.auth.service import current
from contest_detective.server.notifications.watch import service

router = APIRouter()


class WatchUpdate(BaseModel):
    enabled: bool


class ConsumeRead(BaseModel):
    processed: int


def identity(session, user_id, response):
    response.headers['Cache-Control'] = 'private, no-store'
    return owner(session, user_id).id


@router.get('/account/watch', response_model=Response[service.WatchRead])
def read_watch(response: HttpResponse, before_event_id: int | None = Query(default=None, ge=1),
               user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = identity(session, user_id, response)
    session.rollback()
    service.consume(sessionmaker(bind=session.get_bind(), expire_on_commit=False), user)
    return Response.success(service.read(session, user, before_event_id=before_event_id))


@router.put('/account/watch/{contest_id}', response_model=Response[service.StatusRead])
def set_watch(contest_id: str, body: WatchUpdate, response: HttpResponse,
              user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = identity(session, user_id, response)
    service.set_enabled(session, user, contest_id, body.enabled)
    return Response.success(next(row for row in service.statuses(session, user) if row.contest_id == contest_id))


@router.post('/account/watch/consume', response_model=Response[ConsumeRead])
def consume_watch(response: HttpResponse, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    user = identity(session, user_id, response)
    session.rollback()
    return Response.success(ConsumeRead(processed=service.consume(
        sessionmaker(bind=session.get_bind(), expire_on_commit=False), user)))


@router.post('/account/watch/notifications/{event_id}/read', response_model=Response[None])
def mark_read(event_id: int, response: HttpResponse, user_id: str | None = Depends(current), session: Session = Depends(get_session)):
    service.mark_read(session, identity(session, user_id, response), event_id)
    return Response.success()
