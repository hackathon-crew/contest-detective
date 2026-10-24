"""Evidence-bearing content contracts; no acquisition or persistence side effects."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

CoverageState = Literal[
    'not_fetched', 'fetch_failed', 'extract_failed', 'not_found_in_source',
    'source_unpublished', 'found', 'conflict',
]
DocumentKind = Literal['page', 'structured', 'search_snippet']


class ContentCitation(BaseModel):
    model_config = ConfigDict(extra='forbid')

    url: str = Field(min_length=1)
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    excerpt: str = Field(min_length=1)


class ContestIntroduction(BaseModel):
    model_config = ConfigDict(extra='forbid')

    text: str = Field(min_length=1, max_length=500)
    method: Literal['extractive', 'reviewed'] = 'extractive'
    citations: list[ContentCitation] = Field(min_length=1)


class ContestDocument(BaseModel):
    model_config = ConfigDict(extra='forbid')

    url: str = Field(min_length=1)
    site: str
    title: str
    is_official: bool
    published_at: AwareDatetime | None = None
    kind: DocumentKind = 'page'
    representation: Literal['extracted_text', 'markdown', 'plain_text', 'structured_json'] = 'extracted_text'
    fetch_method: Literal['http', 'browser', 'web_tool', 'cached_web_excerpt', 'structured_adapter']
    completeness: Literal['full', 'partial']
    body: str = Field(min_length=1)
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    retrieved_at: AwareDatetime
    extractor_version: str = Field(min_length=1, max_length=100)


class CoverageObservation(BaseModel):
    model_config = ConfigDict(extra='forbid')

    state: CoverageState = 'not_fetched'
    urls: list[str] = Field(default_factory=list)
    checked_at: AwareDatetime | None = None
    reason: str | None = None
    citations: list[ContentCitation] = Field(default_factory=list)


class ContentCoverage(BaseModel):
    model_config = ConfigDict(extra='forbid')

    introduction: CoverageObservation = Field(default_factory=CoverageObservation)
    fields: dict[str, CoverageObservation] = Field(default_factory=dict)
    sources: dict[str, CoverageObservation] = Field(default_factory=dict)
