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

    introduction: Mapped[dict | None] = mapped_column(JSON)
    documents: Mapped[list] = mapped_column(JSON, default=list, server_default='[]')
    coverage: Mapped[dict] = mapped_column(JSON, default=dict, server_default='{}')
    themes: Mapped[list] = mapped_column(JSON, default=list, server_default='[]')
    theme_sources: Mapped[list] = mapped_column(JSON, default=list, server_default='[]')

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
    extractor_version: Mapped[str | None] = mapped_column(String(100))


class ContestClaim(Base):
    __tablename__ = 'contest_claims'

    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True)
    field: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(Text, primary_key=True)
    excerpt: Mapped[str] = mapped_column(Text)
    precision: Mapped[str] = mapped_column(String(8), default='datetime', server_default='datetime')


class ContestPageLink(Base):
    """即使本轮没抽到字段，仍保留网页与赛事的关联供下轮更新。"""
    __tablename__ = 'contest_page_links'

    revision: Mapped[int] = mapped_column(Integer, default=0, server_default='0')
    verified_content_hash: Mapped[str | None] = mapped_column(String(64))
    verified_extractor_version: Mapped[str | None] = mapped_column(String(100))

    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True)


class ContestEvent(Base):
    """已提交的赛事版本；与赛事一起回滚，消费者只读递增序号。"""
    __tablename__ = 'contest_events'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contest_id: Mapped[str] = mapped_column(ForeignKey('contests.id', ondelete='CASCADE'), index=True)
    before_snapshot: Mapped[dict | None] = mapped_column(JSON)
    after_snapshot: Mapped[dict | None] = mapped_column(JSON)
    kind: Mapped[str] = mapped_column(String(10))
    version: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
