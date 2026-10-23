import uuid

from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions, schemas
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from contest_detective.common.exceptions import BizException
from .manager import UserManager
from .models import User
from .schemas import Profile, PublicUser


def public(user: User) -> PublicUser:
    return PublicUser(id=str(user.id), username=user.email, profile=Profile.model_validate(user.profile or {}))


def manager(session):
    return UserManager(SQLAlchemyUserDatabase(session, User))


async def create(session, username: str, password: str) -> User:
    try:
        return await manager(session).create(schemas.BaseUserCreate(email=username, password=password), safe=True)
    except exceptions.UserAlreadyExists as exc:
        raise BizException('账号已存在', code=409) from exc
    except exceptions.InvalidPasswordException as exc:
        raise BizException(exc.reason, code=400) from exc


async def verify(session, username: str, password: str) -> User | None:
    credentials = OAuth2PasswordRequestForm(username=username, password=password)
    return await manager(session).authenticate(credentials)


def get(session, user_id: str) -> PublicUser | None:
    try:
        key = uuid.UUID(user_id)
    except ValueError:
        return None
    user = session.get(User, key)
    return public(user) if user else None


async def confirm_profile(session, user_id: str, profile: Profile) -> PublicUser:
    user = await session.get(User, uuid.UUID(user_id))
    if user is None:
        raise BizException('用户不存在', code=404)
    user.profile = profile.model_dump(mode='json')
    await session.commit()
    return public(user)
