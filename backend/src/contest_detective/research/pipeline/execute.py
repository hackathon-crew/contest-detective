"""运行同步管道并写入比赛库。"""

import asyncio
import logging
from contextlib import nullcontext

import httpx

from contest_detective.framework.config.app import AppSettings, get_app_settings
from contest_detective.research.pipeline.models import ContestSyncContext, ContestSyncInput, ContestSyncOutput
from contest_detective.research.pipeline.persist import persist
from contest_detective.research.pipeline.stages import (
    DraftVerify, PageExtract, PageRetrieve, StructuredCollect, StructuredDeduplicate, StructuredDetail, StructuredEnrich, StructuredNormalize,
)

logger = logging.getLogger(__name__)


async def reconcile_existing(session_factory, *, normalizer=None, apply=False, contest_ids=None, limit=None):
    """默认只清点历史多值文字字段；显式 apply 才调用模型、更新派生判断。"""
    from collections import Counter
    from sqlalchemy import select
    from contest_detective.contest import service
    from contest_detective.contest.models import Contest
    from contest_detective.contest.schemas import TEXT_FIELDS
    from contest_detective.research.normalization import reconcile_fields

    report = {'candidates': 0, 'maximum_model_requests': 0, 'input_characters': 0,
              'fields': {}, 'applied': 0, 'unresolved_fields': 0, 'failed': 0, 'failures': []}
    if apply and normalizer is None:
        raise ValueError('历史信息整理需要配置模型')
    with session_factory() as session:
        statement = select(Contest.id).order_by(Contest.id)
        if contest_ids is not None:
            statement = statement.where(Contest.id.in_(contest_ids))
        ids = list(session.scalars(statement))
    counts = Counter()
    for contest_id in ids:
        with session_factory() as session:
            detail = service.get(session, contest_id)
            if detail is None:
                continue
            previous = service.field_resolutions(session, contest_id)
        kept = await reconcile_fields(detail.name, detail.fields, None, previous=previous)
        pending = [field for field in TEXT_FIELDS if field not in kept
                   and len({source.value for source in detail.fields[field].sources}) > 1]
        if not pending:
            continue
        if limit is not None and report['candidates'] >= limit:
            break
        report['candidates'] += 1
        report['maximum_model_requests'] += 1
        for field in pending:
            counts[field] += 1
            report['input_characters'] += sum(len(source.value) + len(source.excerpt) + len(source.url)
                                               for source in detail.fields[field].sources)
        if not apply:
            continue
        try:
            decisions = await reconcile_fields(detail.name, detail.fields, normalizer, previous=previous)
            resolved = {field: decisions[field] for field in pending if field in decisions}
            report['unresolved_fields'] += len(pending) - len(resolved)
            if resolved:
                with session_factory() as session:
                    service.apply_field_resolutions(session, contest_id, resolved)
                report['applied'] += 1
        except Exception as error:
            report['failed'] += 1
            report['failures'].append({'contest_id': contest_id, 'error_type': type(error).__name__})
    report['fields'] = dict(sorted(counts.items()))
    return report


def run_pipeline(session_factory, *, extractor=None, normalizer=None, tavily=None, client=None,
                 settings: AppSettings | None = None, sources=None, searcher=None, fetcher=None,
                 listings=None, sleep=None, now=None, detail_fetcher=None, publish_notifications=True) -> ContestSyncOutput:
    resolved = settings if settings is not None else get_app_settings()
    ctx = ContestSyncContext(request=ContestSyncInput(keywords=('黑客松',)))
    from contest_detective.contest.service import event_publication
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
        from contest_detective.research.detail import safe_page_reader
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
                await DraftVerify(session_factory, normalizer).run(ctx)
            persist(session_factory, ctx)
            kept = list(ctx.records)
            ctx.extracted_items.clear()
            ctx.records.clear()
            if settings.sync_collect in {'unstructured', 'both'} and extractor is not None:
                from contest_detective.research.verification import verify_recent
                checked = await verify_recent(
                    extractor=extractor, session_factory=session_factory, fetcher=fetcher, now=now, normalizer=normalizer,
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
                    await DraftVerify(session_factory, normalizer).run(ctx)
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
