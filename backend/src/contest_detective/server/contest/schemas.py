from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

ContestField = Literal['start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified', 'city', 'mode', 'prize', 'registration_url', 'organizer']
VerificationLevel = Literal['official', 'reposted', 'conflict', 'not_found']
ContestStatus = Literal['upcoming', 'ongoing', 'ended']
DATE_FIELDS = ('start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified')
DEADLINE_FIELDS = ('registration_deadline', 'submission_deadline', 'deadline_unspecified')
AGGREGATOR_DOMAINS = ('hackertrip.space', 'hackathonradar.com')


def utc_iso(value: str) -> str:
    """赛事日期以秒为粒度，统一时区和精度后才可用字符串排序。"""
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('日期必须包含时区')
    return parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


class PageIn(BaseModel):
    url: str
    site: str
    title: str
    published_at: datetime | None = None
    is_official: bool

    @field_validator('published_at')
    @classmethod
    def utc_publication(cls, value):
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('发布时间必须包含时区')
        return value.astimezone(timezone.utc)

    @model_validator(mode='after')
    def aggregator_is_reposted(self):
        host = (urlsplit(self.url).hostname or '').lower().rstrip('.')
        if any(host == domain or host.endswith('.' + domain) for domain in AGGREGATOR_DOMAINS):
            self.is_official = False
        return self


class ClaimIn(BaseModel):
    field: ContestField
    value: str
    excerpt: str

    @model_validator(mode='after')
    def canonical_value(self):
        if self.field in DATE_FIELDS:
            self.value = utc_iso(self.value)
        elif self.field == 'mode' and self.value not in ('online', 'offline', 'hybrid'):
            raise ValueError('参赛形式必须为 online、offline 或 hybrid')
        return self


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
