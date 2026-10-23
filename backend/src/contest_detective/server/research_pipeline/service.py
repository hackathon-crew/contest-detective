from pydantic import BaseModel


class SyncReport(BaseModel):
    saved: int = 0
    failed: int = 0


def run_sync(session_factory) -> SyncReport:
    raise NotImplementedError


def run(url: str) -> str | None:
    raise NotImplementedError
