import uuid

from fastapi_users_db_sqlalchemy import GUID
from sqlalchemy import JSON, BigInteger, ForeignKey, ForeignKeyConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class ChatConversation(Base):
    __tablename__ = 'chat_conversations'

    # Client IDs are unique within an account; legacy IDs may repeat across accounts.
    user_id: Mapped[uuid.UUID] = mapped_column(GUID, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class ChatTurn(Base):
    __tablename__ = 'chat_turns'
    __table_args__ = (ForeignKeyConstraint(
        ['user_id', 'conversation_id'], ['chat_conversations.user_id', 'chat_conversations.id'], ondelete='CASCADE'),)

    user_id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[int] = mapped_column(BigInteger)
    # SavedTurn contains the public message, sources and steps, never provider credentials.
    data: Mapped[dict] = mapped_column(JSON)
