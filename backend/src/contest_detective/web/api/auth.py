from fastapi import APIRouter, Depends, Request, Response as HttpResponse
from pydantic import BaseModel, EmailStr, Field
import uuid
from sqlalchemy import select, func
from contest_detective.server.account.models import Follow, Track
from sqlalchemy.ext.asyncio import AsyncSession

from contest_detective.common.exceptions import BizException
from contest_detective.common.result import Response
from contest_detective.framework.async_db import get_async_session
from contest_detective.server.auth import service
from contest_detective.server.user import service as users
from contest_detective.server.user.schemas import Profile, PublicUser

router = APIRouter()


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


def copy_cookie(source, target):
    for value in source.headers.getlist('set-cookie'):
        target.headers.append('set-cookie', value)


@router.post('/auth/register', response_model=Response[PublicUser])
async def register(body: Credentials, session: AsyncSession = Depends(get_async_session)):
    return Response.success(await service.register(session, body.email, body.password))


@router.post('/auth/login', response_model=Response[PublicUser])
async def login(body: Credentials, response: HttpResponse, session: AsyncSession = Depends(get_async_session)):
    user, cookie = await service.login(session, body.email, body.password)
    copy_cookie(cookie, response)
    return Response.success(user)


@router.post('/auth/logout', response_model=Response[None])
async def logout(request: Request, response: HttpResponse):
    copy_cookie(await service.logout(request), response)
    return Response.success()


@router.get('/auth/me', response_model=Response[PublicUser | None])
async def me(request: Request):
    user = await service.user_for_request(request)
    return Response.success(users.public(user) if user else None)


@router.put('/user/profile', response_model=Response[PublicUser])
async def confirm_profile(body: Profile, user_id: str | None = Depends(service.current), session: AsyncSession = Depends(get_async_session)):
    if not user_id:
        raise BizException('请先登录', code=401)
    return Response.success(await users.confirm_profile(session, user_id, body))


@router.get('/account/summary', response_model=Response[dict[str, int]])
async def account_summary(user_id: str | None = Depends(service.current), session: AsyncSession = Depends(get_async_session)):
    if not user_id:
        raise BizException('请先登录', code=401)
    owner = uuid.UUID(user_id)
    follows = await session.scalar(select(func.count()).select_from(Follow).where(Follow.user_id == owner))
    tracks = await session.scalar(select(func.count()).select_from(Track).where(Track.user_id == owner))
    return Response.success({'follows': follows or 0, 'tracks': tracks or 0})
