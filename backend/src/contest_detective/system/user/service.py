import uuid

from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions, schemas
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.exc import IntegrityError

from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.exceptions import BizException
from .manager import UserManager
from .models import User
from .schemas import Profile, PublicUser


def public(user: User) -> PublicUser:
    return PublicUser(id=str(user.id), username=user.email, profile=Profile.model_validate(user.profile or {}))


class _RegistrationUserDatabase(SQLAlchemyUserDatabase):
    async def create(self, create_dict):
        # Commit the account and consume its email verification code together.
        user = self.user_table(**create_dict)
        self.session.add(user)
        await self.session.flush()
        return user


def manager(session):
    return UserManager(SQLAlchemyUserDatabase(session, User))


async def create(session, username: str, password: str) -> User:
    try:
        registration = UserManager(_RegistrationUserDatabase(session, User))
        return await registration.create(schemas.BaseUserCreate(email=username, password=password), safe=True)
    except (exceptions.UserAlreadyExists, IntegrityError) as exc:
        raise BizException('账号已存在', code=409) from exc
    except exceptions.InvalidPasswordException as exc:
        raise BizException(exc.reason, code=400) from exc


async def verify(session, username: str, password: str) -> User | None:
    credentials = OAuth2PasswordRequestForm(username=username, password=password)
    return await manager(session).authenticate(credentials)


def chat_is_unlimited(user: User) -> bool:
    return user.unlimited_chat or not get_app_settings().query_limits_enabled


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
