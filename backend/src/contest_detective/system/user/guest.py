"""访客额度只记每日用量，不保存提问和回答。日界线按北京时间计算。"""
from typing import Literal
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.orm import Session

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.db import lock_for_write
from .models import GuestQuestionUsage

BEIJING = ZoneInfo('Asia/Shanghai')


class GuestQuestionQuota(BaseModel):
    limit: Literal[3] = 3
    remaining: int = Field(ge=0, le=3)
    resets_at: AwareDatetime
    action: Literal['login'] | None = None


class GuestQuestions:
    def __init__(self, session: Session):
        self.session = session

    def quota(self, identity: str) -> GuestQuestionQuota:
        day = datetime.now(BEIJING).date()
        usage = self.session.get(GuestQuestionUsage, (identity, day))
        return GuestQuestionQuota(remaining=3 - len(usage.investigation_ids) if usage else 3,
            resets_at=datetime.combine(day + timedelta(days=1), time(), BEIJING))

    def consume(self, identity: str, investigation_id: str) -> GuestQuestionQuota:
        """现存任务由运行层续读；已回收的旧编号不能再启动一次免费查证。"""
        lock_for_write(self.session, GuestQuestionUsage)
        day = datetime.now(BEIJING).date()
        usage = self.session.get(GuestQuestionUsage, (identity, day))
        if usage is None:
            usage = GuestQuestionUsage(identity=identity, day=day, investigation_ids=[])
            self.session.add(usage)
        if investigation_id in usage.investigation_ids:
            raise BizException('该查证已结束，请重新发起提问。', code=409)
        if len(usage.investigation_ids) == 3:
            quota = self.quota(identity).model_copy(update={'action': 'login'})
            raise BizException('今天的三次访客提问已用完，登录后继续。', code=429, data=quota.model_dump(mode='json'))
        usage.investigation_ids = [*usage.investigation_ids, investigation_id]
        self.session.flush()
        return self.quota(identity)
