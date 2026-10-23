import uuid

from fastapi_users_db_sqlalchemy import GUID
from fastapi_users_db_sqlalchemy.access_token import SQLAlchemyBaseAccessTokenTableUUID
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class AccessToken(SQLAlchemyBaseAccessTokenTableUUID, Base):
    __tablename__ = 'sessions'
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
