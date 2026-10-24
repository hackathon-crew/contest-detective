"""同步管道契约。

环节读填充物里已有的字段，把结果写回同一对象。
采集范围来自应用配置 ``sync_collect``。``both`` 时先结构化采集，再检索和抽取，最后验证。
"""

from typing import Protocol, runtime_checkable

from contest_detective.framework.config.app import AppSettings, get_app_settings
from contest_detective.server.research_pipeline.pipeline.models import ContestSyncContext, ContestSyncOutput


@runtime_checkable
class ContestSyncStage(Protocol):
    """管道中的一个环节。"""

    async def run(self, ctx: ContestSyncContext) -> None: ...


@runtime_checkable
class ContestSyncPipeline(Protocol):
    """一次同步。返回已验证的比赛。"""

    async def run(self, ctx: ContestSyncContext) -> ContestSyncOutput: ...


class SequentialContestSync:
    """按 ``sync_collect`` 调用环节。``both`` 时两条采集顺序执行，不并行。"""

    def __init__(self, *, structured: ContestSyncStage, retrieve: ContestSyncStage,
                 extract: ContestSyncStage, verify: ContestSyncStage,
                 enrich: ContestSyncStage | None = None,
                 deduplicate: ContestSyncStage | None = None,
                 detail: ContestSyncStage | None = None,
                 normalize: ContestSyncStage | None = None,
                 settings: AppSettings | None = None) -> None:
        self._structured = structured
        self._enrich = enrich
        self._deduplicate = deduplicate
        self._detail = detail
        self._normalize = normalize
        self._retrieve = retrieve
        self._extract = extract
        self._verify = verify
        self._collect = (settings if settings is not None else get_app_settings()).sync_collect

    async def run(self, ctx: ContestSyncContext) -> ContestSyncOutput:
        if self._collect in {'structured', 'both'}:
            await self._structured.run(ctx)
            if self._enrich is not None:
                await self._enrich.run(ctx)
            if self._deduplicate is not None:
                await self._deduplicate.run(ctx)
            if self._detail is not None:
                await self._detail.run(ctx)
            if self._normalize is not None:
                await self._normalize.run(ctx)
        if self._collect in {'unstructured', 'both'}:
            await self._retrieve.run(ctx)
            await self._extract.run(ctx)
        await self._verify.run(ctx)
        return ContestSyncOutput(records=list(ctx.records), failed=ctx.failed, skipped=ctx.skipped,
            stage_counts=ctx.stage_counts, source_inventory=ctx.source_inventory, failures=ctx.failures)


def configured_pipeline(*, client, extractor, searcher=None, tavily=None, normalizer=None,
                        settings: AppSettings | None = None, fetcher=None, detail_fetcher=None):
    """用具体环节装好一条管道。检索默认走元宝与 Tavily，采集范围读应用配置。"""
    from contest_detective.server.research_pipeline.pipeline.stages import (
        DraftVerify, PageExtract, PageRetrieve, StructuredCollect, StructuredDeduplicate, StructuredDetail, StructuredEnrich, StructuredNormalize,
    )

    resolved = settings if settings is not None else get_app_settings()
    if fetcher is None and detail_fetcher is not None:
        from contest_detective.server.research_pipeline.detail import safe_page_reader
        fetcher = safe_page_reader(detail_fetcher)
    return SequentialContestSync(
        structured=StructuredCollect(client),
        enrich=StructuredEnrich(tavily),
        deduplicate=StructuredDeduplicate(),
        detail=StructuredDetail(detail_fetcher) if detail_fetcher is not None else None,
        normalize=StructuredNormalize(normalizer) if normalizer is not None else None,
        retrieve=PageRetrieve(searcher),
        extract=PageExtract(extractor, fetcher),
        verify=DraftVerify(),
        settings=resolved,
    )
