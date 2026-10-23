from pydantic import BaseModel

from contest_detective.server.research_pipeline.record import run


class SyncReport(BaseModel):
    saved: int = 0
    failed: int = 0


def run_sync(session_factory) -> SyncReport:
    raise NotImplementedError
