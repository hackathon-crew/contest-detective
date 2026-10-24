"""同步管道的入参、填充物和出参。

入参只描述要找什么样的比赛。来源自己的翻页条数、检索词扩写不放在这里。
填充物沿管道传递，由后续环节写回。出参是已经合并好的赛事。
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from contest_detective.server.contest.schemas import ContestDraft, ContestField, FieldValue
from contest_detective.server.contest.content import ContentCoverage, ContestDocument, ContestIntroduction
from contest_detective.server.research_pipeline.refresh.contracts import RefreshFailure, SourceInventory
from contest_detective.server.research_pipeline.structured import StructuredCandidate


class ContestSyncInput(BaseModel):
    """一次同步要找的比赛。

    ``mode`` 为空表示不限线上或线下。``country`` 为空表示全球。
    采集走结构化、非结构化还是两者，由应用配置 ``sync_collect`` 决定。
    """

    name: str | None = None
    keywords: tuple[str, ...] = ()
    mode: Literal['online', 'offline', 'hybrid'] | None = None
    country: str | None = None

    @model_validator(mode='after')
    def has_subject(self):
        if not (self.name and self.name.strip()) and not any(item.strip() for item in self.keywords):
            raise ValueError('需要比赛名称或关键词')
        return self


class RetrievedPage(BaseModel):
    """检索环节写入的一条结果。摘要在 ``content``，全文尚未取到时 ``raw_content`` 为空。"""

    url: str
    title: str = ''
    content: str = ''
    raw_content: str | None = None
    score: float | None = None


class ContestSyncContext(BaseModel):
    """管道填充物。调用方只放入 ``request``，其余字段由环节写回同一对象。

    结构化来源直接写入 ``extracted_items``。非结构化来源先写入 ``retrieved_pages``，
    抽取后再进入 ``extracted_items``。``records`` 只放验证之后的比赛。
    """

    request: ContestSyncInput
    retrieved_pages: list[RetrievedPage] = Field(default_factory=list)
    extracted_items: list[ContestDraft] = Field(default_factory=list)
    structured_candidates: list[StructuredCandidate] = Field(default_factory=list)
    records: list['ContestRecord'] = Field(default_factory=list)
    contest_by_url: dict[str, str] = Field(default_factory=dict)
    failed: int = Field(default=0, ge=0)
    skipped: int = Field(default=0, ge=0)
    verified: int = Field(default=0, ge=0)
    stage_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    source_inventory: list[SourceInventory] = Field(default_factory=list)
    failures: list[RefreshFailure] = Field(default_factory=list)


class ContestRecord(BaseModel):
    """交给比赛库的一条赛事。``fields`` 已含采纳值和全部出处。"""

    name: str = Field(min_length=1, max_length=500)
    cover_url: str | None = None
    summary: str | None = None
    contest_id: str | None = None
    fields: dict[ContestField, FieldValue] = Field(default_factory=dict)
    introduction: ContestIntroduction | None = None
    documents: list[ContestDocument] = Field(default_factory=list)
    coverage: ContentCoverage = Field(default_factory=ContentCoverage)
    themes: list[str] | None = None
    theme_pages: dict[str, list[str]] = Field(default_factory=dict)


class ContestSyncOutput(BaseModel):
    """管道出参。失败和跳过的条目不进入 ``records``。"""

    records: list[ContestRecord] = Field(default_factory=list)
    saved: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    skipped: int = Field(default=0, ge=0)
    verified: int = Field(default=0, ge=0)
    stage_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    source_inventory: list[SourceInventory] = Field(default_factory=list)
    failures: list[RefreshFailure] = Field(default_factory=list)
