"""运行同步管道并写入比赛库。"""

import asyncio
import logging
from contextlib import nullcontext

import httpx

from contest_detective.framework.config.app import AppSettings, get_app_settings
from contest_detective.server.research_pipeline.pipeline.models import ContestSyncContext, ContestSyncInput, ContestSyncOutput
from contest_detective.server.research_pipeline.pipeline.persist import persist
from contest_detective.server.research_pipeline.pipeline.stages import (
    DraftVerify, PageExtract, PageRetrieve, StructuredCollect, StructuredDeduplicate, StructuredDetail, StructuredEnrich, StructuredNormalize,
)

logger = logging.getLogger(__name__)


def run_pipeline(session_factory, *, extractor=None, normalizer=None, tavily=None, client=None,
                 settings: AppSettings | None = None, sources=None, searcher=None, fetcher=None,
                 listings=None, sleep=None, now=None, detail_fetcher=None, publish_notifications=True) -> ContestSyncOutput:
    resolved = settings if settings is not None else get_app_settings()
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))
    from contest_detective.server.contest.service import event_publication
    async def execute():
        with event_publication(publish_notifications):
            return await _run(
                ctx, session_factory, resolved, extractor, normalizer, tavily, client, sources, searcher, fetcher, listings, sleep, now, detail_fetcher,
            )
    coroutine = execute()
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()


async def _run(ctx, session_factory, settings, extractor, normalizer, tavily, client, sources, searcher, fetcher, listings, sleep, now,
               detail_fetcher):
    if fetcher is None and detail_fetcher is not None:
        from contest_detective.server.research_pipeline.detail import safe_page_reader
        fetcher = safe_page_reader(detail_fetcher)
    owned = client is None
    active = client if client is not None else httpx.Client(timeout=10, headers={
        'User-Agent': 'ContestDetective/0.1 (+https://github.com/hackathon-crew/contest-detective)',
    })
    context = nullcontext(active)
    try:
        with context:
            if settings.sync_collect in {'structured', 'both'}:
                await StructuredCollect(active, sources).run(ctx)
                await StructuredEnrich(tavily).run(ctx)
                await StructuredDeduplicate().run(ctx)
                if detail_fetcher is not None:
                    await StructuredDetail(detail_fetcher).run(ctx)
                if normalizer is not None:
                    await StructuredNormalize(normalizer).run(ctx)
                else:
                    logger.info('Structured normalization skipped reason=not_configured candidates=%s',
                                len(ctx.structured_candidates))
            if ctx.extracted_items:
                await DraftVerify(session_factory).run(ctx)
            persist(session_factory, ctx)
            kept = list(ctx.records)
            ctx.extracted_items.clear()
            ctx.records.clear()
            if settings.sync_collect in {'unstructured', 'both'} and extractor is not None:
                from contest_detective.server.research_pipeline.verification import verify_recent
                checked = await verify_recent(
                    extractor=extractor, session_factory=session_factory, fetcher=fetcher, now=now,
                )
                ctx.verified += checked.verified
                ctx.skipped += checked.unchanged
                ctx.failed += checked.failed
                ctx.failures.extend(checked.failures)
                ctx.stage_counts['verify'] = {
                    'attempted': checked.attempted, 'verified': checked.verified,
                    'unchanged': checked.unchanged, 'failed': checked.failed,
                }
                await PageRetrieve(searcher, listings, active).run(ctx)
                await PageExtract(extractor, fetcher, sleep).run(ctx)
                if ctx.extracted_items:
                    await DraftVerify(session_factory).run(ctx)
                persist(session_factory, ctx)
                kept.extend(ctx.records)
    finally:
        if owned:
            active.close()
    return ContestSyncOutput(
        records=kept, saved=len({record.contest_id for record in kept if record.contest_id is not None}),
        failed=ctx.failed, skipped=ctx.skipped, verified=ctx.verified,
        stage_counts=ctx.stage_counts, source_inventory=ctx.source_inventory, failures=ctx.failures,
    )
