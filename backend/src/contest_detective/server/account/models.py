import uuid
from datetime import datetime, timezone

from fastapi_users_db_sqlalchemy import GUID
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


def now():
    return datetime.now(timezone.utc)


class AccountSettings(Base):
    __tablename__ = 'account_settings'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    push: Mapped[dict] = mapped_column(JSON, default=dict)
    search: Mapped[dict] = mapped_column(JSON, default=dict)
    # 字典只放加密后的凭据及非秘密模型选项；读取接口另建脱敏投影。
    providers: Mapped[dict] = mapped_column(JSON, default=dict)
    calendar_secret: Mapped[str | None] = mapped_column(String(128), unique=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Follow(Base):
    __tablename__ = 'account_follows'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    reminders: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_fingerprint: Mapped[str | None] = mapped_column(String(64))


class Track(Base):
    __tablename__ = 'account_tracks'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    text: Mapped[str] = mapped_column(String(80))
    conditions: Mapped[dict] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seen_contests: Mapped[list] = mapped_column(JSON, default=list)


class MailDelivery(Base):
    __tablename__ = 'account_mail'
    __table_args__ = (UniqueConstraint('user_id', 'message_key', name='uq_account_mail_message'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), index=True)
    message_key: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    subject: Mapped[str] = mapped_column(Text)
    html: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    sender: Mapped[str] = mapped_column(String(320))
    recipient: Mapped[str] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(String(10), default='sending')
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PersonalToken(Base):
    __tablename__ = 'personal_tokens'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(16))
    last_four: Mapped[str] = mapped_column(String(4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailChange(Base):
    __tablename__ = 'email_changes'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
