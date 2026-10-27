import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from html import escape
from fastapi_users.password import PasswordHelper
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from contest_detective.framework.exceptions import BizException
from contest_detective.system.account.models import (
    AccountSettings,
    EmailChange,
    Follow,
    MailDelivery,
    PersonalToken,
    Track,
)
from contest_detective.system.account.schemas import (
    MailPreview,
    PushSettings,
    SearchPreferences,
)
from contest_detective.system.account.store import owner, settings_for
from contest_detective.system.auth.models import AccessToken
from contest_detective.system.user.models import User
from contest_detective.agent.models import Investigation, TraceRecord
from contest_detective.system.notifications.config import get_account_runtime_settings
from contest_detective.system.notifications.models import (
    PendingNotification,
    SeenNotification,
)
from contest_detective.system.notifications.service import deliver
from contest_detective.system.notifications.watch.models import Cursor, Notification, Subscription
from contest_detective.system.notifications.watch.service import export_data


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def read_account(session, user_id):
    user = owner(session, user_id)
    row = settings_for(session, user.id)
    return dict(
        email=user.email,
        email_verified=user.is_verified,
        created_at=user.created_at,
        password_changed_at=row.password_changed_at,
        follows_count=session.scalar(
            select(func.count()).select_from(Follow).where(Follow.user_id == user.id)
        )
        or 0,
    )


def request_email(session, user_id, email, mailer):
    user = owner(session, user_id)
    _send_verification(session, user, str(email), mailer, changing=True)


def request_verification(session, user_id, mailer):
    user = owner(session, user_id)
    if user.is_verified:
        raise BizException("邮箱已验证", code=400)
    _send_verification(session, user, user.email, mailer, changing=False)


def _send_verification(session, user, email, mailer, *, changing):
    email = email.lower()
    exists = session.scalar(
        select(User).where(func.lower(User.email) == email, User.id != user.id)
    )
    if exists:
        raise BizException("这个邮箱已被使用", code=409)
    now = datetime.now(timezone.utc)
    pending = session.get(EmailChange, user.id)
    if pending and utc(pending.expires_at) > now + timedelta(minutes=19):
        raise BizException("验证请求太频繁，请稍后再试", code=429)
    token = secrets.token_urlsafe(32)
    digest = sha256(token.encode()).hexdigest()
    if pending is None:
        pending = EmailChange(user_id=user.id)
        session.add(pending)
    (pending.email, pending.token_hash, pending.expires_at) = (
        email,
        digest,
        now + timedelta(minutes=20),
    )
    config = get_account_runtime_settings()
    link = (
        config.public_base_url.rstrip("/") + "/api/account/email/verify?token=" + token
    )
    intro = (
        "确认将 Inkpaw 登录邮箱设为 " + escape(email) + "。"
        if changing
        else "确认这是你的 Inkpaw 登录邮箱：" + escape(email) + "。"
    )
    message = MailPreview(
        subject="验证你的 Inkpaw 登录邮箱",
        sender=config.mail_sender or "Inkpaw",
        recipient=email,
        html="<p>"
        + intro
        + '</p><p><a href="'
        + escape(link, quote=True)
        + '">验证邮箱</a></p><p>链接 20 分钟内有效。如果不是你发起的，请忽略这封邮件。</p>',
        text=intro
        + "\n验证邮箱："
        + link
        + "\n链接 20 分钟内有效。如果不是你发起的，请忽略这封邮件。",
    )
    deliver(
        session,
        user,
        mailer,
        message,
        key="email:" + digest,
        kind="email",
        now=now,
        sensitive=True,
    )
    return


def verify_email(session, token):
    change = session.scalar(
        select(EmailChange).where(
            EmailChange.token_hash == sha256(token.encode()).hexdigest()
        )
    )
    if change is None or utc(change.expires_at) <= datetime.now(timezone.utc):
        raise BizException("验证链接已过期或已经使用，请重新发验证邮件", code=400)
    user = session.get(User, change.user_id)
    if not user or not user.is_active:
        raise BizException("验证链接无效", code=400)
    exists = session.scalar(
        select(User).where(
            func.lower(User.email) == change.email.lower(), User.id != user.id
        )
    )
    if exists:
        raise BizException("这个邮箱已被使用，请重新选择邮箱", code=409)
    (user.email, user.is_verified) = (change.email, True)
    session.delete(change)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise BizException("这个邮箱已被使用，请重新选择邮箱", code=409) from None
    return


def change_password(session, user_id, current_password, new_password, keep_token):
    user = owner(session, user_id)
    helper = PasswordHelper()
    (valid, _) = helper.verify_and_update(current_password, user.hashed_password)
    if not valid:
        raise BizException("现在的密码不正确", code=400)
    user.hashed_password = helper.hash(new_password)
    settings_for(session, user.id).password_changed_at = datetime.now(timezone.utc)
    session.execute(
        delete(AccessToken).where(
            AccessToken.user_id == user.id, AccessToken.token != keep_token
        )
    )
    session.commit()
    return


def export_account(session, user_id):
    user = owner(session, user_id)
    row = settings_for(session, user.id)
    return {
        "watch": export_data(session, user.id),
        "email": user.email,
        "created_at": utc(user.created_at).isoformat(),
        "profile": user.profile,
        "follows": [
            {
                "contest_id": item.contest_id,
                "reminders": item.reminders,
                "created_at": utc(item.created_at).isoformat(),
            }
            for item in session.scalars(select(Follow).where(Follow.user_id == user.id))
        ],
        "tracks": [
            {"text": item.text, "conditions": item.conditions, "enabled": item.enabled}
            for item in session.scalars(select(Track).where(Track.user_id == user.id))
        ],
        "push": PushSettings.model_validate(row.push or {}).model_dump(mode="json"),
        "search": SearchPreferences.model_validate(row.search or {}).model_dump(
            mode="json"
        ),
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }


def delete_account(session, user_id, email):
    user = owner(session, user_id)
    if email.strip() != user.email:
        raise BizException("请输入当前登录邮箱确认删除", code=400)
    investigations = select(Investigation.id).where(
        Investigation.user_id == str(user.id)
    )
    session.execute(
        delete(TraceRecord).where(TraceRecord.investigation_id.in_(investigations))
    )
    session.execute(delete(Investigation).where(Investigation.user_id == str(user.id)))
    for model in (
        Cursor,
        Notification,
        Subscription,
        AccessToken,
        PendingNotification,
        SeenNotification,
        Follow,
        Track,
        MailDelivery,
        PersonalToken,
        EmailChange,
        AccountSettings,
    ):
        session.execute(delete(model).where(model.user_id == user.id))
    session.delete(user)
    session.commit()
    return
