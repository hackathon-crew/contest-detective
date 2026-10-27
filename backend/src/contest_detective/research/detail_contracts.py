"""Bounded public detail retrieval and extraction ports, not registered stages."""

from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from contest_detective.contest.content import (
    ContentCoverage, ContestDocument, ContestIntroduction, CoverageObservation,
)
from contest_detective.contest.schemas import ClaimIn, PageIn


class DetailTarget(BaseModel):
    model_config = ConfigDict(extra='forbid')

    page: PageIn
    contest_name: str
    purpose: str = 'detail'


class DetailFetchResult(BaseModel):
    document: ContestDocument | None = None
    coverage: CoverageObservation = Field(default_factory=CoverageObservation)


class DetailExtractionResult(BaseModel):
    claims: list[ClaimIn] = Field(default_factory=list)
    introduction: ContestIntroduction | None = None
    coverage: ContentCoverage = Field(default_factory=ContentCoverage)


class PublicDetailFetcher(Protocol):
    async def __call__(self, target: DetailTarget) -> DetailFetchResult: ...


class DetailContentExtractor(Protocol):
    async def __call__(self, document: ContestDocument) -> DetailExtractionResult: ...
