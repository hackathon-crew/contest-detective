"""Observed page checks; independent of account and notification domains."""
from typing import Literal

from pydantic import AwareDatetime, BaseModel, model_validator


class PageCheck(BaseModel):
    contest_id: str
    # Actual attempt start and completion, never the planned schedule.
    checked_at: AwareDatetime
    completed_at: AwareDatetime
    outcome: Literal['changed', 'unchanged', 'failed', 'no_source']
    source_url: str | None = None
    error_type: str | None = None

    @model_validator(mode='after')
    def observed_completion(self):
        if self.completed_at < self.checked_at:
            raise ValueError('检查完成时间不能早于开始时间')
        if self.outcome in ('changed', 'unchanged') and (not self.source_url or self.error_type):
            raise ValueError('成功检查必须有真实来源且没有错误')
        if self.outcome == 'failed' and not self.error_type:
            raise ValueError('失败检查必须有错误类型')
        if self.outcome == 'no_source' and self.error_type:
            raise ValueError('缺少来源不应伪装为抓取失败')
        if self.outcome == 'no_source' and self.source_url is not None:
            raise ValueError('缺少来源时不能宣称有来源')
        return self
