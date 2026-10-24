from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class Contest(Base):
    __tablename__ = 'contests'
    __table_args__ = (UniqueConstraint('normalized_name', 'start_date', name='uq_contest_name_start'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(500))
    normalized_name: Mapped[str] = mapped_column(String(500))
    start_date: Mapped[str | None] = mapped_column(String(10), index=True)
    # Compatibility projections retained while readers migrate to contest_details.
    cover_url: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[str | None] = mapped_column(String(20))
    end_at: Mapped[str | None] = mapped_column(String(20))
    next_deadline: Mapped[str | None] = mapped_column(String(20))
    mode: Mapped[str | None] = mapped_column(String(10), index=True)
    city: Mapped[str | None] = mapped_column(Text)
    fields: Mapped[dict] = mapped_column(JSON, default=dict)


class ContestDetails(Base):
    __tablename__ = 'contest_details'

    contest_id: Mapped[str] = mapped_column(
        ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True,
    )
    cover_url: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[str | None] = mapped_column(String(20))
    end_at: Mapped[str | None] = mapped_column(String(20))
    next_deadline: Mapped[str | None] = mapped_column(String(20))
    mode: Mapped[str | None] = mapped_column(String(10), index=True)
    city: Mapped[str | None] = mapped_column(Text)
    fields: Mapped[dict] = mapped_column(JSON, default=dict)


class ContestPage(Base):
    __tablename__ = 'contest_pages'

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    url: Mapped[str] = mapped_column(Text, unique=True)
    site: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    published_at: Mapped[str | None] = mapped_column(String(20))
    is_official: Mapped[bool] = mapped_column(Boolean)
    content_hash: Mapped[str | None] = mapped_column(String(64))


class ContestClaim(Base):
    __tablename__ = 'contest_claims'

    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True)
    field: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    excerpt: Mapped[str] = mapped_column(Text)
    precision: Mapped[str] = mapped_column(String(8), default='datetime', server_default='datetime')


class ContestPageLink(Base):
    """即使本轮没抽到字段，仍保留网页与赛事的关联供下轮更新。"""
    __tablename__ = 'contest_page_links'

    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True)


class ContestEvent(Base):
    """已提交的赛事版本；与赛事一起回滚，消费者只读递增序号。"""
    __tablename__ = 'contest_events'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    version: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
