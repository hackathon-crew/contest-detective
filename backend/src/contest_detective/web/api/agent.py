import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session, sessionmaker
from sse_starlette.sse import EventSourceResponse

from contest_detective.common.result import Response
from contest_detective.framework.db import get_session
from contest_detective.framework.config.app import get_app_settings
from contest_detective.server.account.providers import runtime_for
from contest_detective.server.agent.loop import Investigator, create_investigator
from contest_detective.server.agent.schemas import AskRequest
from contest_detective.server.agent.schemas import ContestRecommendation, ResolveRecommendations
from contest_detective.server.agent.recommendations import resolve_previous
from contest_detective.server.auth.service import get_current_user_id

router = APIRouter()
limiter = Limiter(key_func=get_remote_address, storage_uri='memory://')


@router.post('/agent/recommendations/resolve', response_model=Response[list[ContestRecommendation]])
def resolve_recommendations(body: ResolveRecommendations, session: Session = Depends(get_session)):
    return Response.success(resolve_previous(session, body))


async def get_request_user_id(request: Request) -> str | None:
    return await get_current_user_id(request)


async def get_investigator(body: AskRequest, session: Session = Depends(get_session),
                           user_id: str | None = Depends(get_request_user_id)) -> AsyncIterator[Investigator]:
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    runtime = runtime_for(session, user_id)
    investigator = create_investigator(session_factory=factory, model_settings=runtime.llm,
                                      search_settings=runtime.search, preferences=runtime.preferences)
    async with investigator.agent:
        yield investigator


async def question_stream(request: Request, body: AskRequest, investigator: Investigator, user_id: str | None):
    async def stream():
        async for event in investigator.ask(body.question, user_id, profile=body.profile, history=body.history):
            yield {'event': event.type, 'data': json.dumps(event.payload, ensure_ascii=False)}
    return EventSourceResponse(stream(), headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


limited_question = limiter.limit('5/minute;30/day')(question_stream)


@router.post('/agent/ask', response_class=EventSourceResponse,
             responses={200: {'content': {'text/event-stream': {}}}})
async def ask_question(request: Request, body: AskRequest,
                       investigator: Investigator = Depends(get_investigator),
                       user_id: str | None = Depends(get_request_user_id)):
    try:
        handler = limited_question if get_app_settings().query_limits_enabled else question_stream
        return await handler(request, body, investigator, user_id)
    except RateLimitExceeded:
        return JSONResponse(status_code=200, content=Response.fail('提问过于频繁，请稍后再试', code=429).model_dump(mode='json'))
