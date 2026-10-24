"""Offline imports are explicit, auditable, and independent of model providers."""

from pathlib import Path
from typing import Literal, Protocol

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from contest_detective.server.contest.content import (
    ContentCoverage, ContestDocument, ContestIntroduction,
)
from contest_detective.server.contest.schemas import ClaimIn


class SourceInventory(BaseModel):
    model_config = ConfigDict(extra='forbid')

    source: str
    listing_urls: list[str] = Field(default_factory=list)
    discovered: int = Field(default=0, ge=0)
    fetched: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    termination: Literal['exhausted', 'bounded', 'blocked', 'failed']
    reason: str | None = None


class RefreshDocument(BaseModel):
    model_config = ConfigDict(extra='forbid')

    document: ContestDocument
    claims: list[ClaimIn] = Field(default_factory=list)


class RefreshEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')

    key: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=500)
    contest_id: str | None = None
    expected_fingerprint: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    cover_url: str | None = None
    introduction: ContestIntroduction | None = None
    documents: list[RefreshDocument] = Field(min_length=1)
    coverage: ContentCoverage = Field(default_factory=ContentCoverage)


class RefreshManifest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    schema_version: Literal['contest-refresh-v1'] = 'contest-refresh-v1'
    manifest_id: str = Field(min_length=1, max_length=100)
    extractor_version: str = Field(min_length=1, max_length=100)
    created_at: AwareDatetime
    scope: str = Field(min_length=1)
    inventory: list[SourceInventory] = Field(default_factory=list)
    entries: list[RefreshEntry] = Field(default_factory=list)


class RefreshFailure(BaseModel):
    key: str
    stage: Literal['validate', 'identity', 'persist', 'fetch', 'extract']
    reason: str
    url: str | None = None
    retryable: bool = False


class RefreshReport(BaseModel):
    manifest_id: str
    dry_run: bool = True
    attempted: int = Field(default=0, ge=0)
    validated: int = Field(default=0, ge=0)
    created: int = Field(default=0, ge=0)
    updated: int = Field(default=0, ge=0)
    unchanged: int = Field(default=0, ge=0)
    failed: int = Field(default=0, ge=0)
    failures: list[RefreshFailure] = Field(default_factory=list)
    backup_path: str | None = None
    journal_path: str | None = None


class OfflineRefreshImporter(Protocol):
    def run(self, manifest: RefreshManifest, *, database: Path, dry_run: bool = True,
            output_directory: Path) -> RefreshReport: ...


class OfflineRefreshRollback(Protocol):
    def restore(self, *, database: Path, journal: Path) -> None: ...
