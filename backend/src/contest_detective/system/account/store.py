import uuid
from contest_detective.framework.exceptions import BizException
from contest_detective.system.user.models import User
from .models import AccountSettings


def owner_id(user_id):
    if not user_id:
        raise BizException('请先登录', code=401)
    return uuid.UUID(user_id)


def owner(session, user_id):
    user = session.get(User, owner_id(user_id))
    if not user or not user.is_active:
        raise BizException('请先登录', code=401)
    return user


def settings_for(session, user_id):
    key = user_id if isinstance(user_id, uuid.UUID) else owner_id(user_id)
    row = session.get(AccountSettings, key)
    if row is None:
        row = AccountSettings(user_id=key, push={}, search={}, providers={})
        session.add(row)
    return row


def verified(user):
    if not user.is_verified:
        raise BizException('请先验证收件邮箱', code=400)
