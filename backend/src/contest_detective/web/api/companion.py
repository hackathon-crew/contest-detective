"""Authenticated, bounded document-answer endpoint for the native companion."""

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session, sessionmaker

from contest_detective.common.exceptions import BizException
from contest_detective.common.result import Response
from contest_detective.framework.db import get_session
from contest_detective.server.account.providers import runtime_for
from contest_detective.server.auth.service import current as query_user
from contest_detective.server.agent.llm import create_model
from contest_detective.server.auth import service as auth
from contest_detective.server.documents.schemas import MAX_QUESTION_BYTES, DocumentAnswer, DocumentQuestion
from contest_detective.server.documents.service import BoundedDocumentAnswerer, DocumentAnswering


class BoundedDocumentRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def bounded(request: Request):
            # Read incrementally before FastAPI parses JSON. Content-Length alone
            # cannot enforce a bound on chunked or incorrectly declared bodies.
            content = bytearray()
            async for chunk in request.stream():
                if len(content) + len(chunk) > MAX_QUESTION_BYTES:
                    raise BizException('问题与文档片段总量不能超过 24KiB', code=400)
                content.extend(chunk)
            # Starlette's request cache is in-memory only and reused by FastAPI.
            request._body = bytes(content)
            try:
                return await original(request)
            except RequestValidationError:
                # The global validation response includes offending input values.
                raise BizException('问题或文档片段格式不正确', code=400) from None

        return bounded


router = APIRouter(route_class=BoundedDocumentRoute)
limiter = Limiter(key_func=get_remote_address, storage_uri='memory://')


def get_document_answerer(session: Session = Depends(get_session), user_id: str | None = Depends(query_user)) -> DocumentAnswering:
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    runtime = runtime_for(session, user_id)
    return BoundedDocumentAnswerer(model_factory=lambda: create_model(settings=runtime.llm, session_factory=factory))


@limiter.limit('5/minute;30/day')
async def limited_document_question(request: Request, body: DocumentQuestion, answerer: DocumentAnswering):
    return Response.success(await answerer.answer(body))


@router.post('/companion/documents/ask', response_model=Response[DocumentAnswer])
async def ask_document(request: Request, body: DocumentQuestion,
                       user_id: str | None = Depends(auth.current),
                       answerer: DocumentAnswering = Depends(get_document_answerer)):
    if not user_id:
        raise BizException('请先登录', code=401)
    try:
        return await limited_document_question(request, body, answerer)
    except RateLimitExceeded:
        return Response.fail('提问过于频繁，请稍后再试', code=429)
