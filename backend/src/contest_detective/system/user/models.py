from datetime import datetime, timezone

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = 'users'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    profile: Mapped[dict] = mapped_column(JSON, default=dict)
