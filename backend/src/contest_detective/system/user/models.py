from datetime import date, datetime, timezone

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import JSON, Date, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = 'users'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    profile: Mapped[dict] = mapped_column(JSON, default=dict)


class GuestQuestionUsage(Base):
    __tablename__ = 'guest_question_usage'
    identity: Mapped[str] = mapped_column(String(64), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    investigation_ids: Mapped[list[str]] = mapped_column(JSON)
