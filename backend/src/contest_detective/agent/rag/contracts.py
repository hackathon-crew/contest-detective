"""One contest is one embedding; retrieval returns existing sourced summaries."""
from dataclasses import dataclass
from typing import Callable, Protocol

from sqlalchemy.orm import Session

from contest_detective.contest.schemas import ContestQuery, ContestSummary


@dataclass(frozen=True)
class IndexDocument:
    contest_id: str
    text: str
    content_hash: str


@dataclass
class IndexReport:
    updated: int = 0
    unchanged: int = 0
    failed: int = 0


class EmbeddingProvider(Protocol):
    def embed(self, text: str) -> list[float]: ...


class ContestRetriever(Protocol):
    def search(self, session: Session, query: ContestQuery, *, attendable: bool = False,
               blocked_domains: tuple[str, ...] = ()) -> tuple[list[ContestSummary], int]: ...


class ContestIndexer(Protocol):
    def refresh(self, session_factory: Callable[..., Session]) -> IndexReport: ...
