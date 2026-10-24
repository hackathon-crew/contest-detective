"""运行同步管道并写入比赛库。"""

import asyncio
from contextlib import nullcontext

import httpx

from contest_detective.framework.config.app import AppSettings, get_app_settings
from contest_detective.server.research_pipeline.pipeline.models import ContestSyncContext, ContestSyncInput, ContestSyncOutput
from contest_detective.server.research_pipeline.pipeline.persist import persist
from contest_detective.server.research_pipeline.pipeline.stages import (
    DraftVerify, PageExtract, PageRetrieve, StructuredCollect,
)


def run_pipeline(session_factory, *, extractor=None, client=None, settings: AppSettings | None = None,
                 sources=None, searcher=None, fetcher=None, listings=None, sleep=None, now=None) -> ContestSyncOutput:
    resolved = settings if settings is not None else get_app_settings()
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))
    coroutine = _run(
        ctx, session_factory, resolved, extractor, client, sources, searcher, fetcher, listings, sleep, now,
    )
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()


async def _run(ctx, session_factory, settings, extractor, client, sources, searcher, fetcher, listings, sleep, now):
    owned = client is None
    active = client if client is not None else httpx.Client(timeout=10, headers={
        'User-Agent': 'ContestDetective/0.1 (+https://github.com/hackathon-crew/contest-detective)',
    })
    context = nullcontext(active)
    saved = 0
    try:
        with context:
            if settings.sync_collect in {'structured', 'both'}:
                await StructuredCollect(active, sources).run(ctx)
            await DraftVerify(session_factory).run(ctx)
            saved += persist(session_factory, ctx)
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
                await PageRetrieve(searcher, listings, active).run(ctx)
                await PageExtract(extractor, fetcher, sleep).run(ctx)
                await DraftVerify(session_factory).run(ctx)
                saved += persist(session_factory, ctx)
                kept.extend(ctx.records)
    finally:
        if owned:
            active.close()
    return ContestSyncOutput(
        records=kept, saved=saved, failed=ctx.failed, skipped=ctx.skipped, verified=ctx.verified,
    )
