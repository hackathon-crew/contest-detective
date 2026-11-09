"""Reusable invitations for beta registration."""

import secrets
from hashlib import sha256

from sqlalchemy.exc import IntegrityError

from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.exceptions import BizException
from contest_detective.system.user.models import User
from .models import RegistrationInvite

_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'


def can_manage(user: User) -> bool:
    admin = get_app_settings().invite_admin_email
    return bool(admin and user.is_verified and user.email.casefold() == admin.casefold())


def _digest(code: str) -> str:
    return sha256(code.strip().upper().encode()).hexdigest()


def issue(session) -> str:
    while True:
        code = ''.join(secrets.choice(_ALPHABET) for _ in range(6))
        digest = _digest(code)
        session.add(RegistrationInvite(code_hash=digest))
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            if session.get(RegistrationInvite, digest) is None:
                raise
        else:
            return code


def check(session, code: str) -> None:
    if session.get(RegistrationInvite, _digest(code)) is None:
        raise BizException('邀请码无效，请检查后重新输入。', code=403)
