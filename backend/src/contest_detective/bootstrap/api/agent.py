import json
from collections.abc import AsyncIterator
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session, sessionmaker
from sse_starlette.sse import EventSourceResponse
from sse_starlette.event import ServerSentEvent

from contest_detective.framework.result import Response
from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import get_session
from contest_detective.framework.config.app import get_app_settings
from contest_detective.system.account.providers import runtime_for
from contest_detective.agent.loop import Investigator, create_investigator
from contest_detective.agent.models import Investigation
from contest_detective.agent.schemas import AskRequest, TraceEvent
from contest_detective.agent.chat.service import SqlConversationStore
from contest_detective.agent.schemas import ContestRecommendation, ResolveRecommendations
from contest_detective.agent.recommendations import resolve_previous
from contest_detective.system.auth.service import require_user

router = APIRouter(dependencies=[Depends(require_user)])
limiter = Limiter(key_func=get_remote_address, storage_uri='memory://')
SSE_PING_SECONDS = 10
get_request_user_id = require_user


@router.post('/agent/recommendations/resolve', response_model=Response[list[ContestRecommendation]])
def resolve_recommendations(body: ResolveRecommendations, session: Session = Depends(get_session)):
    return Response.success(resolve_previous(session, body))


def get_ask_request(body: AskRequest):
    # Every dependency must share the same generated identifiers for older clients.
    if body.investigation_id is None:
        body.investigation_id = uuid4()
    return body


def prepare_chat_turn(body: AskRequest = Depends(get_ask_request), user_id: str = Depends(get_request_user_id), session: Session = Depends(get_session)):
    store = SqlConversationStore(session, user_id)
    previous = store.find_investigation(str(body.investigation_id))
    if previous is not None:
        if 'conversation_id' not in body.model_fields_set:
            body.conversation_id = previous.conversation_id
        if 'turn_id' not in body.model_fields_set:
            body.turn_id = previous.id
    store.start(body.conversation_id, body.turn_id, body.question, investigation_id=str(body.investigation_id),
                retry_of=str(body.retry_of) if body.retry_of else None,
                saved_request={'profile': body.profile, 'verificationOptions': {'mode': body.mode, 'confirmed_claims': body.confirmed_claims}})
    session.commit()


def save_chat_event(request, body, user_id, event):
    with request.app.state.chat_session_factory() as session:
        SqlConversationStore(session, user_id).record(body.conversation_id, body.turn_id, event)
        session.commit()


async def get_investigator(request: Request, body: AskRequest = Depends(get_ask_request), session: Session = Depends(get_session),
                           user_id: str = Depends(get_request_user_id)) -> AsyncIterator[Investigator | None]:
    try:
        if body.confirmed_claims:
            raise BizException('截图与深度核验暂时停用，请使用普通文字推荐或查询比赛库。', code=503)
        if session.get(Investigation, str(body.investigation_id)):
            row = request.app.state.investigations.get(str(body.investigation_id), user_id)
            if row.question != body.question:
                raise BizException('该查证编号已经使用，请重新发起查证。', code=409, data={'action': 'retry'})
            yield None
            return
        factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        runtime = runtime_for(session, user_id)
        investigator = create_investigator(session_factory=factory, model_settings=runtime.llm,
                                          search_settings=runtime.search, preferences=runtime.preferences, mode=body.mode)
    except BizException as exc:
        action = exc.data.get('action') if isinstance(exc.data, dict) else None
        save_chat_event(request, body, user_id, TraceEvent(type='error', payload={'message': exc.message, 'action': action or 'retry'}))
        raise
    try:
        yield investigator
    finally:
        if not investigator.started:
            async with investigator.agent:
                pass


def event_response(runs, investigation_id, owner_id, after=0):
    runs.get(investigation_id, owner_id)
    async def stream():
        async for event in runs.events(investigation_id, owner_id, after=after):
            yield {'id': str(event.seq), 'event': event.type, 'data': json.dumps(event.payload, ensure_ascii=False)}
    return EventSourceResponse(stream(), ping=SSE_PING_SECONDS,
        ping_message_factory=lambda: ServerSentEvent(event='ping', data='{}'),
        headers={'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no'})


async def question_stream(request: Request, body: AskRequest, investigator: Investigator | None, user_id: str):
    runs = request.app.state.investigations
    investigation_id = runs.start(investigator, body, user_id, user_id, require_owner=True) if investigator else str(body.investigation_id)
    return event_response(runs, investigation_id, user_id)


limited_question = limiter.limit('5/minute;30/day')(question_stream)


@router.post('/agent/ask', response_class=EventSourceResponse,
             dependencies=[Depends(prepare_chat_turn)],
             responses={200: {'content': {'text/event-stream': {}}}})
async def ask_question(request: Request, body: AskRequest = Depends(get_ask_request),
                       investigator: Investigator | None = Depends(get_investigator),
                       user_id: str = Depends(get_request_user_id)):
    try:
        handler = limited_question if investigator is not None and get_app_settings().query_limits_enabled else question_stream
        return await handler(request, body, investigator, user_id)
    except RateLimitExceeded:
        save_chat_event(request, body, user_id, TraceEvent(type='error', payload={'message': '提问过于频繁，请稍后再试', 'action': 'retry'}))
        return JSONResponse(status_code=200, content=Response.fail('提问过于频繁，请稍后再试', code=429).model_dump(mode='json'))


@router.get('/agent/investigations/{investigation_id}/events', response_class=EventSourceResponse)
async def investigation_events(investigation_id: str, request: Request, after: int = Query(default=0, ge=0),
                               last_event_id: int = Header(default=0, alias='Last-Event-ID', ge=0),
                               user_id: str = Depends(get_request_user_id)):
    return event_response(request.app.state.investigations, investigation_id, user_id, max(after, last_event_id))


@router.post('/agent/investigations/{investigation_id}/cancel', response_model=Response[None])
async def cancel_investigation(investigation_id: str, request: Request, user_id: str = Depends(get_request_user_id)):
    await request.app.state.investigations.cancel(investigation_id, user_id)
    return Response.success(None)
