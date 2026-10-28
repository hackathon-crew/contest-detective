"""LangChain 结构化赛事归一化的模型输出。"""

from typing import Annotated

from pydantic import BaseModel, Field

from contest_detective.research.claims import ExtractedClaims
from contest_detective.contest.schemas import ContestField


class NormalizedFieldMerge(BaseModel):
    field: ContestField
    value: str | None = None
    conflicting: bool = False
    reason: str | None = None
    claim_indexes: list[Annotated[int, Field(strict=True, ge=0)]] = Field(min_length=1)


class NormalizedContest(BaseModel):
    """模型返回抽取字段或文字合并结论；页面身份和数据库写入由程序处理。"""

    name: str = Field(min_length=1, max_length=500)
    cover_url: str | None = None
    summary: str | None = None
    claims: ExtractedClaims = Field(default_factory=list)
    field_merges: list[NormalizedFieldMerge] = Field(default_factory=list)
