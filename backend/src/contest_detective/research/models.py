"""每日同步是否已经跑过。同一窗口重启不再开第二轮。"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from contest_detective.framework.db import Base


class PipelineRun(Base):
    __tablename__ = 'pipeline_runs'

    job_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ran_on: Mapped[str] = mapped_column(String(10))
