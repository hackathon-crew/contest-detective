from fastapi import APIRouter, Depends, Request, Response as HttpResponse
from pydantic import BaseModel, EmailStr, Field
import uuid
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from contest_detective.system.account.models import Track
from contest_detective.system.account.follows import active_count
from sqlalchemy.ext.asyncio import AsyncSession

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.framework.async_db import get_async_session
from contest_detective.framework.db import get_session
from contest_detective.system.auth import campaign, invites, registration, service
from contest_detective.system.auth.campaign_contracts import CampaignArrival
from contest_detective.system.user import service as users
from contest_detective.system.user.schemas import Profile, PublicUser
from ..handler import SensitiveRoute
from .mail import get_mailer

router = APIRouter(route_class=SensitiveRoute)


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class InviteRequest(BaseModel):
    invite_code: str = Field(min_length=1, max_length=32)


class RegisterCredentials(Credentials, InviteRequest):
    code: str = Field(pattern=r'^[0-9]{6}$')


class CodeRequest(InviteRequest):
    email: EmailStr


def copy_cookie(source, target):
    for value in source.headers.getlist('set-cookie'):
        target.headers.append('set-cookie', value)


@router.post('/auth/register/invite', response_model=Response[None])
def validate_invite(body: InviteRequest, session: Session = Depends(get_session)):
    invites.check(session, body.invite_code)
    return Response.success()


@router.post('/auth/register/code', response_model=Response[None])
def request_register_code(body: CodeRequest, session: Session = Depends(get_session), mailer=Depends(get_mailer)):
    invites.check(session, body.invite_code)
    registration.request_code(session, str(body.email), mailer)
    return Response.success()


@router.post('/auth/campaign-visit', response_model=Response[None])
def record_campaign_visit(body: CampaignArrival, request: Request, response: HttpResponse,
                          session: Session = Depends(get_session)):
    visitor = campaign.record_arrival(session, body, request.cookies.get(campaign.COOKIE_NAME))
    response.set_cookie(campaign.COOKIE_NAME, visitor, max_age=campaign.COOKIE_MAX_AGE,
                        httponly=True, secure=True, samesite='lax')
    return Response.success()


@router.post('/auth/register', response_model=Response[PublicUser])
async def register(body: RegisterCredentials, request: Request, session: AsyncSession = Depends(get_async_session)):
    return Response.success(await service.register(
        session, body.email, body.password, body.code, body.invite_code,
        campaign_cookie=request.cookies.get(campaign.COOKIE_NAME),
    ))


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
    follows = await session.run_sync(lambda sync: active_count(sync, owner))
    tracks = await session.scalar(select(func.count()).select_from(Track).where(Track.user_id == owner))
    return Response.success({'follows': follows or 0, 'tracks': tracks or 0})
