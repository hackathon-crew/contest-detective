from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from .content import ContentCoverage, ContestDocument, ContestIntroduction, PublicContestDocument

ContestField = Literal[
    'start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified',
    'city', 'mode', 'prize', 'registration_url', 'organizer', 'venue', 'eligibility', 'team_size',
    'entry_fee', 'entry_requirements', 'judging_criteria', 'past_statistics',
]
VerificationLevel = Literal['official', 'reposted', 'conflict', 'not_found']
ContestStatus = Literal['upcoming', 'ongoing', 'ended']
DatePrecision = Literal['day', 'datetime']
BEIJING = timezone(timedelta(hours=8))
DATE_FIELDS = ('start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified')
DEADLINE_FIELDS = ('registration_deadline', 'submission_deadline', 'deadline_unspecified')
AGGREGATOR_DOMAINS = ('hackertrip.space', 'hackathonradar.com')


def utc_iso(value: str) -> str:
    """赛事日期以秒为粒度，统一时区和精度后才可用字符串排序。"""
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('日期必须包含时区')
    return parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def date_value(value: str, precision: DatePrecision = 'datetime') -> str:
    if precision == 'datetime':
        return utc_iso(value)
    # day 的 UTC00 只是原文日期的排序锚点，不表示原文公布了零点或时区。
    day = date.fromisoformat(value) if len(value) == 10 else datetime.fromisoformat(value).date()
    return day.isoformat() + 'T00:00:00Z'


def calendar_date(value: str, precision: DatePrecision = 'datetime') -> date:
    parsed = datetime.fromisoformat(value)
    return parsed.date() if precision == 'day' else parsed.astimezone(BEIJING).date()


def date_bounds(value: str, precision: DatePrecision = 'datetime') -> tuple[datetime, datetime]:
    if precision == 'day':
        start = datetime.combine(calendar_date(value, precision), time(), BEIJING)
        return start, start + timedelta(days=1)
    exact = datetime.fromisoformat(value)
    return exact, exact


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
    precision: DatePrecision = 'datetime'

    @model_validator(mode='after')
    def canonical_value(self):
        if self.field in DATE_FIELDS:
            self.value = date_value(self.value, self.precision)
        elif self.precision == 'day':
            raise ValueError('只有日期字段可以使用 day 精度')
        elif self.field == 'mode' and self.value not in ('online', 'offline', 'hybrid'):
            raise ValueError('参赛形式必须为 online、offline 或 hybrid')
        return self


class ContestDraft(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    cover_url: str | None = None
    summary: str | None = None
    introduction: ContestIntroduction | None = None
    documents: list[ContestDocument] = Field(default_factory=list)
    coverage: ContentCoverage = Field(default_factory=ContentCoverage)
    themes: list[str] | None = None
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
    precision: DatePrecision = 'datetime'


class FieldValue(BaseModel):
    value: str | None
    level: VerificationLevel
    sources: list[Source] = Field(default_factory=list)
    precision: DatePrecision = 'datetime'


class BriefDate(BaseModel):
    value: str
    precision: DatePrecision


class BriefDeadline(BriefDate):
    field: Literal['registration_deadline', 'submission_deadline', 'deadline_unspecified']


class ContestBrief(BaseModel):
    """供挑选候选的有界名片；完整字段与出处仍从详情读取。"""
    id: str
    name: str
    status: ContestStatus
    start_at: BriefDate | None
    end_at: BriefDate | None
    next_deadline: BriefDeadline | None
    city: str | None
    mode: Literal['online', 'offline', 'hybrid'] | None
    prize: str | None
    themes: list[str]


class ContestSummary(BaseModel):
    id: str
    name: str
    cover_url: str | None
    status: ContestStatus
    fields: dict[ContestField, FieldValue]
    introduction: ContestIntroduction | None = None
    coverage: ContentCoverage = Field(default_factory=ContentCoverage)
    themes: list[str] = Field(default_factory=list)
    theme_sources: list[Source] = Field(default_factory=list)
    content_version: Literal['content-v1'] = 'content-v1'


class ContestDetail(ContestSummary):
    summary: str | None
    documents: list[PublicContestDocument] = Field(default_factory=list)
