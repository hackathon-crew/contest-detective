from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class PushSettings(BaseModel):
    enabled: bool = False
    new_matches: bool = True
    deadline_reminders: bool = True
    changes: bool = True
    tracking: bool = True
    frequency: Literal['daily', 'weekly', 'instant'] = 'weekly'
    weekday: int = Field(default=0, ge=0, le=6)
    time: str = Field(default='08:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    timezone: Literal['Asia/Shanghai'] = 'Asia/Shanghai'
    reminder_days: list[Annotated[int, Field(ge=1, le=30)]] = Field(default_factory=lambda: [3, 1], max_length=30)


class TrackingConditions(BaseModel):
    model_config = ConfigDict(extra='forbid')
    keywords: list[Text] = Field(default_factory=list, max_length=20)
    topics: list[Text] = Field(default_factory=list, max_length=20)
    modes: list[Literal['online', 'offline', 'hybrid']] = Field(default_factory=list, max_length=3)
    city: Text | None = None
    has_prize: bool = False
    deadline_from: date | None = None
    deadline_to: date | None = None

    @model_validator(mode='after')
    def date_order(self):
        if self.deadline_from and self.deadline_to and self.deadline_to < self.deadline_from:
            raise ValueError('截止日期范围结束早于开始')
        return self


class TrackInput(BaseModel):
    text: Text


class TrackRead(BaseModel):
    id: str
    text: str
    conditions: TrackingConditions
    enabled: bool
    matched_count: int
    last_sent_at: datetime | None = None


class SearchPreferences(BaseModel):
    scope: Literal['all', 'cn', 'intl'] = 'all'
    exclude_ended: bool = True
    blocked_domains: list[Text] = Field(default_factory=list, max_length=50)


class TokenMetadata(BaseModel):
    prefix: str
    last_four: str
    created_at: datetime
    last_used_at: datetime | None = None


class TokenCreated(BaseModel):
    token: str
    metadata: TokenMetadata


class ProviderInput(BaseModel):
    # 名字与 .env.example 去除 DETECTIVE_ 前缀后一致；值只在写入时接收。
    llm_vendor: Literal['deepseek', 'openai'] = 'deepseek'
    llm_base_url: str = Field(default='https://api.deepseek.com', max_length=500)
    llm_model: str = Field(default='deepseek-flash', max_length=200)
    llm_api_key: str | None = Field(default=None, min_length=1, max_length=4096)
    yuanbao_secret_id: str | None = Field(default=None, min_length=1, max_length=4096)
    yuanbao_secret_key: str | None = Field(default=None, min_length=1, max_length=4096)
    tavily_api_key: str | None = Field(default=None, min_length=1, max_length=4096)


class MailPreview(BaseModel):
    subject: str
    html: str
    text: str
    sender: str
    recipient: str


class MailRead(MailPreview):
    id: str
    kind: str
    status: Literal['sending', 'sent', 'failed']
    created_at: datetime
    sent_at: datetime | None = None
