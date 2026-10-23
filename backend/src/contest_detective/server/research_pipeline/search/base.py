from typing import Protocol

from pydantic import BaseModel


class SearchHit(BaseModel):
    title: str
    url: str
    site: str
    date: str | None = None
    snippet: str
    provider: str


class SearchProvider(Protocol):
    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]: ...
