from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

from contest_detective.common.exceptions import BizException
from contest_detective.common.result import Response
from contest_detective.framework.db import get_session
from contest_detective.server.account.providers import runtime_for
from contest_detective.server.auth.service import current as query_user
from contest_detective.server.agent.llm import create_model
from contest_detective.server.user.github import build_github_profile
from contest_detective.server.user.matching import match
from contest_detective.server.user.resume import MAX_BYTES, create_profile_extractor, parse_resume
from contest_detective.server.user.schemas import GitHubUsername, MatchItem, Profile

router = APIRouter()


class GitHubInput(BaseModel):
    username: GitHubUsername


def get_github_builder():
    return build_github_profile


def get_resume_extractor(session: Session = Depends(get_session), user_id: str | None = Depends(query_user)):
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    runtime = runtime_for(session, user_id)
    return create_profile_extractor(model_factory=lambda: create_model(settings=runtime.llm, session_factory=factory), manage_model=True)


@router.post('/profile/github', response_model=Response[Profile])
async def github_profile(body: GitHubInput, builder=Depends(get_github_builder)):
    return Response.success(await builder(body.username))


@router.post('/profile/resume', response_model=Response[Profile], openapi_extra={
    'requestBody': {'required': True, 'content': {'application/octet-stream': {
        'schema': {'type': 'string', 'format': 'binary'}}}},
})
async def resume_profile(request: Request,
                         filename: Literal['resume.pdf', 'resume.docx', 'resume.txt'],
                         extractor=Depends(get_resume_extractor)):
    # 用原始请求流，避免上传组件把大文件写入临时目录。URL 只接受固定文件名。
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_BYTES:
            raise BizException('简历不能超过 2MiB', code=400)
        content.extend(chunk)
    return Response.success(await parse_resume(bytes(content), filename=filename, extractor=extractor))


@router.post('/match', response_model=Response[list[MatchItem]])
def match_profile(body: Profile, session: Session = Depends(get_session)):
    return Response.success(match(session, body))
