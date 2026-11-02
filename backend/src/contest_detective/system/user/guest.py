"""访客额度只记每日用量，不保存提问和回答。日界线按北京时间计算。"""
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy.orm import Session

from contest_detective.framework.exceptions import BizException


class GuestQuestionQuota(BaseModel):
    limit: Literal[3] = 3
    remaining: int = Field(ge=0, le=3)
    resets_at: AwareDatetime
    action: Literal['login'] | None = None


class GuestQuestions:
    def __init__(self, session: Session):
        self.session = session

    def quota(self, identity: str) -> GuestQuestionQuota:
        raise BizException('访客提问暂未开放', code=503)

    def consume(self, identity: str, investigation_id: str) -> GuestQuestionQuota:
        """同一身份的已启动查证重连时不重复计次。"""
        raise BizException('访客提问暂未开放', code=503)
