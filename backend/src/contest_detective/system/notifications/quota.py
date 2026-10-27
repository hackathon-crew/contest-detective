"""邮件额度统计：推送邮件和注册验证码共用同一个 Resend 账户。"""

from datetime import timedelta, timezone

from sqlalchemy import func, select

from contest_detective.system.account.models import MailDelivery
from .models import RegistrationCodeSend


def mail_used(session, now):
    day = now - timedelta(days=1)
    month = now.astimezone(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    daily = session.scalar(
        select(func.count()).select_from(MailDelivery).where(MailDelivery.created_at >= day)
    ) or 0
    monthly = session.scalar(
        select(func.count()).select_from(MailDelivery).where(MailDelivery.created_at >= month)
    ) or 0
    daily += session.scalar(
        select(func.count()).select_from(RegistrationCodeSend).where(RegistrationCodeSend.created_at >= day)
    ) or 0
    monthly += session.scalar(
        select(func.count()).select_from(RegistrationCodeSend).where(RegistrationCodeSend.created_at >= month)
    ) or 0
    return daily, monthly
