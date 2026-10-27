import uuid
from datetime import datetime, timezone

from fastapi_users_db_sqlalchemy import GUID
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class PendingNotification(Base):
    """一人一赛事合并成一条待发送项，多条追踪命中不重复寄信。"""
    __tablename__ = 'notification_pending'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer)
    version: Mapped[str] = mapped_column(String(64))
    reason: Mapped[str] = mapped_column(String(20))
    track_ids: Mapped[list] = mapped_column(JSON, default=list)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SeenNotification(Base):
    __tablename__ = 'notification_seen'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    version: Mapped[str] = mapped_column(String(64))
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ConsumerCursor(Base):
    __tablename__ = 'notification_cursors'
    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, default=0)


class RegistrationCodeSend(Base):
    """注册验证码的发信记录。用户尚未创建，因此不能写入 account_mail。"""

    __tablename__ = 'registration_code_sends'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, default=lambda: datetime.now(timezone.utc)
    )
