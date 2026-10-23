import asyncio
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
    verified: int = 0
    skipped: int = 0
    extraction_enabled: bool = False


def source_adapters():
    from contest_detective.server.research_pipeline.sources import devpost, hackertrip, waytoagi

    return [('hackertrip', hackertrip.fetch), ('waytoagi', waytoagi.fetch), ('devpost', devpost.fetch)]


def run_sync(session_factory=SessionLocal, *, client=None, sources=None, extractor=None,
             discoveries=None, verifier=None) -> SyncReport:
    report = SyncReport(extraction_enabled=extractor is not None)
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
    if extractor is not None:
        asyncio.run(_enrich(report, session_factory, extractor, discoveries, verifier))
    return report


def extraction_adapters():
    from contest_detective.server.research_pipeline.sources import huodongxing, wechat

    return [('huodongxing', huodongxing.sync), ('wechat', wechat.sync)]


async def _enrich(report, session_factory, extractor, discoveries, verifier):
    if verifier is None:
        from contest_detective.server.research_pipeline.verification import verify_recent
        verifier = verify_recent
    try:
        checked = await verifier(extractor=extractor, session_factory=session_factory)
        report.verified += checked.verified
        report.skipped += checked.unchanged
        report.failed += checked.failed
    except Exception as exc:
        report.failed += 1
        logger.warning('Organizer verification failed error_type=%s', type(exc).__name__)
    for name, discover in discoveries if discoveries is not None else extraction_adapters():
        try:
            result = await discover(extractor=extractor, session_factory=session_factory)
            report.saved += result.saved
            report.failed += result.failed
            report.skipped += result.skipped
        except Exception as exc:
            report.failed += 1
            logger.warning('Page discovery failed source=%s error_type=%s', name, type(exc).__name__)
