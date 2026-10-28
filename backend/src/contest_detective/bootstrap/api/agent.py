import json
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session, sessionmaker
from sse_starlette.sse import EventSourceResponse

from contest_detective.framework.result import Response
from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import get_session
from contest_detective.framework.config.app import get_app_settings
from contest_detective.system.account.providers import runtime_for
from contest_detective.agent.loop import Investigator, create_investigator
from contest_detective.agent.models import Investigation
from contest_detective.agent.schemas import AskRequest
from contest_detective.agent.schemas import ContestRecommendation, ResolveRecommendations
from contest_detective.agent.recommendations import resolve_previous
from contest_detective.system.auth.service import get_current_user_id

router = APIRouter()
limiter = Limiter(key_func=get_remote_address, storage_uri='memory://')


@router.post('/agent/recommendations/resolve', response_model=Response[list[ContestRecommendation]])
def resolve_recommendations(body: ResolveRecommendations, session: Session = Depends(get_session)):
    return Response.success(resolve_previous(session, body))


async def get_request_user_id(request: Request) -> str | None:
    return await get_current_user_id(request)


async def get_investigator(request: Request, body: AskRequest, session: Session = Depends(get_session),
                           user_id: str | None = Depends(get_request_user_id)) -> Investigator | None:
    if body.confirmed_claims:
        raise BizException('截图与深度核验暂时停用，请使用普通文字推荐或查询比赛库。', code=503)
    if body.investigation_id and session.get(Investigation, str(body.investigation_id)):
        request.app.state.investigations.get(str(body.investigation_id), owner_for(request, user_id))
        return None
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    runtime = runtime_for(session, user_id)
    investigator = create_investigator(session_factory=factory, model_settings=runtime.llm,
                                      search_settings=runtime.search, preferences=runtime.preferences, mode=body.mode)
    return investigator


def owner_for(request, user_id):
    # 访客凭证与登录用户 ID 使用不同命名空间，不能伪造为某个账户。
    guest = request.cookies.get('cd_investigator')
    return user_id or ('g:' + guest if guest else None)


def event_response(runs, investigation_id, owner_id, after=0):
    if owner_id is None:
        raise BizException('查证记录不存在', code=404)
    runs.get(investigation_id, owner_id)
    async def stream():
        async for event in runs.events(investigation_id, owner_id, after=after):
            yield {'id': str(event.seq), 'event': event.type, 'data': json.dumps(event.payload, ensure_ascii=False)}
    return EventSourceResponse(stream(), headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


async def question_stream(request: Request, body: AskRequest, investigator: Investigator, user_id: str | None):
    owner_id = owner_for(request, user_id) or 'g:' + uuid4().hex
    runs = request.app.state.investigations
    investigation_id = runs.start(investigator, body, owner_id, user_id) if investigator else str(body.investigation_id)
    response = event_response(runs, investigation_id, owner_id)
    if user_id is None:
        response.set_cookie('cd_investigator', owner_id[2:], httponly=True, samesite='lax',
                            secure=request.url.scheme == 'https', max_age=7 * 24 * 3600)
    return response


limited_question = limiter.limit('5/minute;30/day')(question_stream)


@router.post('/agent/ask', response_class=EventSourceResponse,
             responses={200: {'content': {'text/event-stream': {}}}})
async def ask_question(request: Request, body: AskRequest,
                       investigator: Investigator = Depends(get_investigator),
                       user_id: str | None = Depends(get_request_user_id)):
    try:
        handler = limited_question if investigator is not None and get_app_settings().query_limits_enabled else question_stream
        return await handler(request, body, investigator, user_id)
    except RateLimitExceeded:
        return JSONResponse(status_code=200, content=Response.fail('提问过于频繁，请稍后再试', code=429).model_dump(mode='json'))


@router.get('/agent/investigations/{investigation_id}/events', response_class=EventSourceResponse)
async def investigation_events(investigation_id: str, request: Request, after: int = Query(default=0, ge=0),
                               last_event_id: int = Header(default=0, alias='Last-Event-ID', ge=0),
                               user_id: str | None = Depends(get_request_user_id)):
    return event_response(request.app.state.investigations, investigation_id, owner_for(request, user_id),
                          max(after, last_event_id))


@router.post('/agent/investigations/{investigation_id}/cancel', response_model=Response[None])
async def cancel_investigation(investigation_id: str, request: Request,
                               user_id: str | None = Depends(get_request_user_id)):
    owner_id = owner_for(request, user_id)
    if owner_id is None:
        raise BizException('查证记录不存在', code=404)
    await request.app.state.investigations.cancel(investigation_id, owner_id)
    return Response.success(None)
