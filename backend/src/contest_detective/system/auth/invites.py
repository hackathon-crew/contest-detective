"""Single-use invitations for new beta accounts."""

import secrets
from hashlib import sha256

from sqlalchemy import delete

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


def _unavailable() -> BizException:
    return BizException('邀请码无效或已使用，请检查邀请码。', code=403)


def issue(session) -> str:
    token = ''.join(secrets.choice(_ALPHABET) for _ in range(16))
    code = 'INK-' + '-'.join(token[index:index + 4] for index in range(0, 16, 4))
    session.add(RegistrationInvite(code_hash=_digest(code)))
    session.commit()
    return code


def check(session, code: str) -> None:
    if session.get(RegistrationInvite, _digest(code)) is None:
        raise _unavailable()


def redeem(session, code: str) -> None:
    # A conditional delete locks redemption to the account transaction, even across workers.
    result = session.execute(delete(RegistrationInvite).where(RegistrationInvite.code_hash == _digest(code)))
    if result.rowcount != 1:
        raise _unavailable()
