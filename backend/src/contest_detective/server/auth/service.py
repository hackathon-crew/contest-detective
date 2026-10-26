from fastapi import Request
from fastapi_users.authentication import AuthenticationBackend, CookieTransport
from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users_db_sqlalchemy.access_token import SQLAlchemyAccessTokenDatabase

from contest_detective.common.exceptions import BizException
from contest_detective.server.user import service as users
from . import registration
from .models import AccessToken

LIFETIME_SECONDS = 7 * 24 * 3600
transport = CookieTransport(cookie_name='cd_session', cookie_max_age=LIFETIME_SECONDS, cookie_secure=False, cookie_httponly=True, cookie_samesite='lax')


def strategy(session):
    return DatabaseStrategy(SQLAlchemyAccessTokenDatabase(session, AccessToken), lifetime_seconds=LIFETIME_SECONDS)


backend = AuthenticationBackend(name='cookie', transport=transport, get_strategy=strategy)


async def register(session, username: str, password: str, code: str):
    email = registration.normalize(username)
    await session.run_sync(lambda sync: registration.check_code(sync, email, code))
    user = await users.create(session, email, password)
    await session.run_sync(lambda sync: registration.clear_code(sync, email, code))
    return users.public(user)


async def login(session, username: str, password: str):
    user = await users.verify(session, username, password)
    if user is None or not user.is_active:
        raise BizException('邮箱或密码不正确', code=401)
    response = await backend.login(strategy(session), user)
    return users.public(user), response


async def user_for_request(request: Request):
    token = request.cookies.get('cd_session')
    if not token:
        return None
    async with request.app.state.async_session_factory() as session:
        user = await strategy(session).read_token(token, users.manager(session))
        return user if user and user.is_active else None


async def current(request: Request) -> str | None:
    user = await user_for_request(request)
    return str(user.id) if user else None


get_current_user_id = current


async def logout(request: Request):
    token = request.cookies.get('cd_session')
    async with request.app.state.async_session_factory() as session:
        if token:
            await strategy(session).destroy_token(token, None)
    return await transport.get_logout_response()
