import logging
from contextlib import nullcontext

import httpx
from pydantic import BaseModel

from contest_detective.framework.db import SessionLocal
from contest_detective.server.research_pipeline.record import run
from contest_detective.server.contest import service as contests

logger = logging.getLogger(__name__)


class SyncReport(BaseModel):
    saved: int = 0
    failed: int = 0


def source_adapters():
    from contest_detective.server.research_pipeline.sources import hackertrip, waytoagi

    return [('hackertrip', hackertrip.fetch), ('waytoagi', waytoagi.fetch)]


def run_sync(session_factory=SessionLocal, *, client=None, sources=None) -> SyncReport:
    report = SyncReport()
    context = nullcontext(client) if client else httpx.Client(
        timeout=10, headers={
            'User-Agent': 'ContestDetective/0.1 (+https://github.com/hackathon-crew/contest-detective)',
        },
    )
    with context as active_client:
        for name, fetch in sources if sources is not None else source_adapters():
            try:
                drafts = fetch(active_client)
            except Exception as exc:
                logger.warning('Source fetch failed source=%s error_type=%s', name, type(exc).__name__)
                report.failed += 1
                continue
            for draft in drafts:
                try:
                    with session_factory() as session:
                        contests.save(session, draft)
                    report.saved += 1
                except Exception as exc:
                    logger.warning('Source save failed source=%s error_type=%s', name, type(exc).__name__)
                    report.failed += 1
    return report
