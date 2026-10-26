"""注册验证码：发码、校验和清理。

验证码只用于建号，不改变用户的 ``is_verified``；邮箱验证是账户中心的独立流程。
"""

import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256

from sqlalchemy import delete, func, select

from contest_detective.common.exceptions import BizException
from contest_detective.server.notifications.config import get_account_runtime_settings
from contest_detective.server.notifications.models import RegistrationCodeSend
from contest_detective.server.notifications.ports import OutgoingMail
from contest_detective.server.notifications.quota import mail_used
from contest_detective.server.user.models import User
from .models import RegistrationCode

CODE_TTL = timedelta(minutes=10)
RESEND_COOLDOWN = timedelta(seconds=60)
SEND_WINDOW = timedelta(hours=1)
MAX_SENDS_PER_WINDOW = 5
MAX_ATTEMPTS = 5


def normalize(value):
    return str(value).strip().lower()


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _digest(email, code):
    return sha256(f'{email}:{code}'.encode()).hexdigest()


def _message(email, code):
    config = get_account_runtime_settings()
    return OutgoingMail(
        key='register:' + secrets.token_urlsafe(16),
        sender=config.mail_sender or 'Inkpaw',
        recipient=email,
        subject='Inkpaw 注册验证码',
        html=(
            '<p>你的 Inkpaw 注册验证码是 <b>'
            + code
            + '</b>，10 分钟内有效。</p><p>如果不是你发起的，请忽略这封邮件。</p>'
        ),
        text=(
            '你的 Inkpaw 注册验证码是 '
            + code
            + '，10 分钟内有效。如果不是你发起的，请忽略这封邮件。'
        ),
    )


def request_code(session, email, mailer, now=None):
    email = normalize(email)
    now = now or datetime.now(timezone.utc)
    if session.scalar(select(User.id).where(func.lower(User.email) == email)) is not None:
        raise BizException('账号已存在', code=409)
    row = session.get(RegistrationCode, email)
    if row is not None:
        if now - _utc(row.last_sent_at) < RESEND_COOLDOWN:
            raise BizException('验证码请求太频繁，请稍后再试', code=429)
        if now - _utc(row.window_started_at) < SEND_WINDOW and row.sends >= MAX_SENDS_PER_WINDOW:
            raise BizException('验证码请求太频繁，请稍后再试', code=429)
    config = get_account_runtime_settings()
    daily, monthly = mail_used(session, now)
    if daily >= config.mail_daily_limit or monthly >= config.mail_monthly_limit:
        raise BizException('邮件免费额度已到上限，请稍后再试', code=429)

    code = f'{secrets.randbelow(1_000_000):06d}'
    try:
        mailer.send(_message(email, code))
    except BizException:
        raise
    except Exception:
        raise BizException('验证码发送失败，请稍后重试', code=503) from None

    if row is None:
        row = RegistrationCode(email=email, attempts=0, sends=0, window_started_at=now)
        session.add(row)
    elif now - _utc(row.window_started_at) >= SEND_WINDOW:
        row.window_started_at, row.sends = now, 0
    row.code_hash = _digest(email, code)
    row.attempts = 0
    row.sends += 1
    row.last_sent_at = now
    row.expires_at = now + CODE_TTL
    session.add(RegistrationCodeSend(email=email, created_at=now))
    session.commit()


def check_code(session, email, code, now=None):
    email = normalize(email)
    now = now or datetime.now(timezone.utc)
    row = session.get(RegistrationCode, email)
    if row is None:
        raise BizException('验证码已过期，请重新获取', code=400)
    if _utc(row.expires_at) <= now:
        session.delete(row)
        session.commit()
        raise BizException('验证码已过期，请重新获取', code=400)
    if row.attempts >= MAX_ATTEMPTS:
        session.delete(row)
        session.commit()
        raise BizException('验证码尝试次数过多，请重新获取', code=400)
    if not secrets.compare_digest(row.code_hash, _digest(email, code)):
        row.attempts += 1
        if row.attempts >= MAX_ATTEMPTS:
            session.delete(row)
            session.commit()
            raise BizException('验证码尝试次数过多，请重新获取', code=400)
        session.commit()
        raise BizException('验证码不正确', code=400)


def clear_code(session, email, code):
    email = normalize(email)
    session.execute(
        delete(RegistrationCode).where(
            RegistrationCode.email == email,
            RegistrationCode.code_hash == _digest(email, code),
        )
    )
    session.commit()
