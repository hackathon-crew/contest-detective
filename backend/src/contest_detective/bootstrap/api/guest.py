import re
import secrets
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, Query, Request, Response as HttpResponse
from sqlalchemy.orm import Session, sessionmaker
from sse_starlette.sse import EventSourceResponse

from contest_detective.framework.db import get_session
from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.system.user.guest import GuestQuestionQuota, GuestQuestions
from contest_detective.system.account.providers import runtime_for
from contest_detective.agent.loop import Investigator, create_investigator
from contest_detective.agent.schemas import AskRequest
from contest_detective.contest import service as contests
from .agent import event_response, get_ask_request

router = APIRouter()


def guest_owner(request: Request) -> str:
    token = request.cookies.get('cd_guest', '')
    return token if re.fullmatch(r'[A-Za-z0-9_-]{43}', token) else secrets.token_urlsafe(32)


def guest_cookie(response, owner, request):
    response.set_cookie('cd_guest', owner, httponly=True, samesite='lax',
        secure=request.url.scheme == 'https', max_age=86400)


@router.get('/agent/guest-quota', response_model=Response[GuestQuestionQuota])
def guest_quota(request: Request, response: HttpResponse, owner: str = Depends(guest_owner),
                session: Session = Depends(get_session)):
    guest_cookie(response, owner, request)
    response.headers['Cache-Control'] = 'private, no-store'
    return Response.success(GuestQuestions(session).quota(request.client.host))


def prepare_guest_turn(request: Request, body: AskRequest = Depends(get_ask_request),
                       owner: str = Depends(guest_owner), session: Session = Depends(get_session)):
    if body.confirmed_claims:
        raise BizException('截图与深度核验暂时停用，请使用普通文字推荐或查询比赛库。', code=503)
    runs = request.app.state.guest_investigations
    investigation_id = str(body.investigation_id)
    if runs.has(investigation_id):
        run = runs.get(investigation_id, owner)
        if run.question != body.question:
            raise BizException('该查证编号已经使用，请重新发起查证。', code=409)
        return
    if body.contest_id and contests.get(session, body.contest_id) is None:
        raise BizException('所选比赛不存在，请重新选择比赛。', code=404)
    with request.app.state.chat_session_factory() as quota_session:
        GuestQuestions(quota_session).consume(request.client.host, investigation_id)
        quota_session.commit()


async def get_guest_investigator(request: Request, body: AskRequest = Depends(get_ask_request),
                                 session: Session = Depends(get_session)) -> AsyncIterator[Investigator | None]:
    if request.app.state.guest_investigations.has(str(body.investigation_id)):
        yield None
        return
    runtime = runtime_for(session, None)
    investigator = create_investigator(session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
        model_settings=runtime.llm, search_settings=runtime.search, preferences=runtime.preferences, mode=body.mode)
    try:
        yield investigator
    finally:
        if not investigator.started:
            async with investigator.agent:
                pass


@router.post('/agent/guest/ask', response_class=EventSourceResponse, dependencies=[Depends(prepare_guest_turn)],
             responses={200: {'content': {'text/event-stream': {}}}})
async def ask_guest_question(request: Request, body: AskRequest = Depends(get_ask_request),
                             owner: str = Depends(guest_owner), investigator: Investigator | None = Depends(get_guest_investigator)):
    runs = request.app.state.guest_investigations
    investigation_id = runs.start(investigator, body, owner) if investigator else str(body.investigation_id)
    response = event_response(runs, investigation_id, owner)
    guest_cookie(response, owner, request)
    return response


@router.get('/agent/guest/investigations/{investigation_id}/events', response_class=EventSourceResponse)
async def guest_events(investigation_id: str, request: Request, owner: str = Depends(guest_owner),
                        after: int = Query(default=0, ge=0), last_event_id: int = Header(default=0, alias='Last-Event-ID', ge=0)):
    return event_response(request.app.state.guest_investigations, investigation_id, owner, max(after, last_event_id))


@router.post('/agent/guest/investigations/{investigation_id}/cancel', response_model=Response[None])
async def cancel_guest(investigation_id: str, request: Request, owner: str = Depends(guest_owner)):
    await request.app.state.guest_investigations.cancel(investigation_id, owner)
    return Response.success(None)
