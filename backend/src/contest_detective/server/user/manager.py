import uuid

from fastapi_users import BaseUserManager, UUIDIDMixin, exceptions

from .models import User


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    async def validate_password(self, password, user):
        if not 8 <= len(password) <= 128:
            raise exceptions.InvalidPasswordException(reason='密码需要 8 到 128 个字符')
