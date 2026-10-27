from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AwareDatetime, BaseModel, Field, StringConstraints, field_validator, model_validator

from contest_detective.contest.schemas import ContestSummary

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
GitHubUsername = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$')]


class AvailabilityWindow(BaseModel):
    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode='after')
    def ordered(self):
        if self.end_at <= self.start_at:
            raise ValueError('可投入时间的结束必须晚于开始')
        return self


class Availability(BaseModel):
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = Field(default_factory=list, max_length=7)
    windows: list[AvailabilityWindow] = Field(default_factory=list, max_length=20)
    max_consecutive_days: int | None = Field(default=None, ge=1, le=30)


class GitHubEvidence(BaseModel):
    name: Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_.-]{1,100}$')]
    url: str = Field(max_length=300)
    description: str | None = Field(default=None, max_length=1000)
    language: ShortText | None = None
    topics: list[ShortText] = Field(default_factory=list, max_length=50)
    pushed_at: AwareDatetime | None = None

    @field_validator('url')
    @classmethod
    def repository_link(cls, value):
        parts = urlsplit(value)
        if (parts.scheme != 'https' or parts.hostname != 'github.com' or parts.username or parts.password
                or len(parts.path.strip('/').split('/')) != 2 or parts.query or parts.fragment):
            raise ValueError('仓库证据必须链接到公开 GitHub 仓库')
        return value


class Profile(BaseModel):
    skills: list[ShortText] = Field(default_factory=list, max_length=50)
    skill_sources: dict[ShortText, list[Literal['github', 'resume', 'manual']]] = Field(default_factory=dict, max_length=50)
    github_read_at: AwareDatetime | None = None
    github_public_repos: int | None = Field(default=None, ge=0)
    resume_name: str | None = Field(default=None, max_length=255)
    identity: str | None = Field(default=None, max_length=500)
    available_time: str | None = Field(default=None, max_length=500)
    city: ShortText | None = None
    github: GitHubUsername | None = None
    topics: list[ShortText] = Field(default_factory=list, max_length=50)
    preferred_modes: list[Literal['online', 'offline', 'hybrid']] = Field(default_factory=list, max_length=3)
    identity_kind: Literal['student', 'professional'] | None = None
    availability: Availability = Field(default_factory=Availability)
    github_evidence: list[GitHubEvidence] = Field(default_factory=list, max_length=100)
    language_repo_share: dict[ShortText, Annotated[float, Field(ge=0, le=1)]] = Field(default_factory=dict, max_length=100)
    github_last_active_at: AwareDatetime | None = None

    @model_validator(mode='after')
    def skill_provenance(self):
        self.skill_sources = {skill: list(dict.fromkeys(self.skill_sources.get(skill) or ['manual'])) for skill in self.skills}
        return self

    @field_validator('identity', 'available_time', mode='before')
    @classmethod
    def trim_optional_text(cls, value):
        return value.strip() or None if isinstance(value, str) else value

    @field_validator('language_repo_share')
    @classmethod
    def bounded_shares(cls, value):
        if sum(value.values()) > 1.000001:
            raise ValueError('仓库语言数量占比不能超过 100%')
        return value


class PublicUser(BaseModel):
    id: str
    username: str
    profile: Profile


class MatchItem(BaseModel):
    contest: ContestSummary
    reason: str
    score: float
