from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

ContestField = Literal['start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified', 'city', 'mode', 'prize', 'registration_url', 'organizer']
VerificationLevel = Literal['official', 'reposted', 'conflict', 'not_found']
ContestStatus = Literal['upcoming', 'ongoing', 'ended']


class PageIn(BaseModel):
    url: str
    site: str
    title: str
    published_at: datetime | None = None
    is_official: bool


class ClaimIn(BaseModel):
    field: ContestField
    value: str
    excerpt: str


class ContestDraft(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    cover_url: str | None = None
    summary: str | None = None
    page: PageIn
    claims: list[ClaimIn]


class ContestQuery(BaseModel):
    keyword: str | None = None
    status: ContestStatus | None = None
    mode: Literal['online', 'offline', 'hybrid'] | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    ids: list[str] | None = None
    sort: Literal['deadline', 'start'] = 'deadline'
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)

    @field_validator('date_from', 'date_to')
    @classmethod
    def utc_dates(cls, value):
        if value is None:
            return value
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc)

    @model_validator(mode='after')
    def ordered_dates(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError('开始日期不能晚于结束日期')
        return self


class Source(PageIn):
    value: str
    excerpt: str
    stale: bool = False


class FieldValue(BaseModel):
    value: str | None
    level: VerificationLevel
    sources: list[Source] = Field(default_factory=list)


class ContestSummary(BaseModel):
    id: str
    name: str
    cover_url: str | None
    status: ContestStatus
    fields: dict[ContestField, FieldValue]


class ContestDetail(ContestSummary):
    summary: str | None
