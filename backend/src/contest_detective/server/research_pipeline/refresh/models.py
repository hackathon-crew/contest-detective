"""Idempotency ledger for explicit offline imports, never scheduled automatically."""
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class ContentRefreshRun(Base):
    __tablename__ = 'content_refresh_runs'

    manifest_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    manifest_hash: Mapped[str] = mapped_column(String(64))


class ContentRefreshEntry(Base):
    __tablename__ = 'content_refresh_entries'

    manifest_id: Mapped[str] = mapped_column(ForeignKey('content_refresh_runs.manifest_id'), primary_key=True)
    entry_key: Mapped[str] = mapped_column(String(200), primary_key=True)
    entry_hash: Mapped[str] = mapped_column(String(64))
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id'))
    after_fingerprint: Mapped[str] = mapped_column(String(64))
