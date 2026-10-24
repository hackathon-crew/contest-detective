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
                 settings: AppSettings | None = None) -> None:
        self._structured = structured
        self._retrieve = retrieve
        self._extract = extract
        self._verify = verify
        self._collect = (settings if settings is not None else get_app_settings()).sync_collect

    async def run(self, ctx: ContestSyncContext) -> ContestSyncOutput:
        if self._collect in {'structured', 'both'}:
            await self._structured.run(ctx)
        if self._collect in {'unstructured', 'both'}:
            await self._retrieve.run(ctx)
            await self._extract.run(ctx)
        await self._verify.run(ctx)
        return ContestSyncOutput(records=list(ctx.records), failed=ctx.failed, skipped=ctx.skipped)


def configured_pipeline(*, client, extractor, searcher=None, settings: AppSettings | None = None, fetcher=None):
    """用具体环节装好一条管道。检索默认走元宝与 Tavily，采集范围读应用配置。"""
    from contest_detective.server.research_pipeline.pipeline.stages import (
        DraftVerify, PageExtract, PageRetrieve, StructuredCollect,
    )

    resolved = settings if settings is not None else get_app_settings()
    return SequentialContestSync(
        structured=StructuredCollect(client),
        retrieve=PageRetrieve(searcher),
        extract=PageExtract(extractor, fetcher),
        verify=DraftVerify(),
        settings=resolved,
    )
