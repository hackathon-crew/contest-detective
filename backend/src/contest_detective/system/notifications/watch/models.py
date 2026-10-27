import uuid
from datetime import datetime

from fastapi_users_db_sqlalchemy import GUID
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class Subscription(Base):
    __tablename__ = 'watch_subscriptions'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    activated_event_id: Mapped[int] = mapped_column(Integer, default=0)


class Cursor(Base):
    __tablename__ = 'watch_cursors'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, default=0)


class Notification(Base):
    __tablename__ = 'watch_notifications'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey('contest_events.id', ondelete='CASCADE'), primary_key=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Check(Base):
    __tablename__ = 'watch_checks'
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str] = mapped_column(String(16))
    source_url: Mapped[str | None] = mapped_column(Text)
    error_type: Mapped[str | None] = mapped_column(String(100))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
