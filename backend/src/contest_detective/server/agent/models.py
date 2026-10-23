"""费用账本中的 reserved 是可能已经消费、尚未确认的金额，不能自动清零。"""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import DateTime, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class LLMUsage(Base):
    __tablename__ = 'llm_usage'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default='reserved')
    reserved_cny: Mapped[Decimal] = mapped_column(Numeric(20, 10))
    cost_cny: Mapped[Decimal] = mapped_column(Numeric(20, 10))
    cache_hit_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_miss_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
