"""同步管道的具体环节。

结构化来源把接口草稿写入 ``extracted_items``。
非结构化来源先写 ``retrieved_pages``，抽取后再进入 ``extracted_items``。
验证只合并本轮草稿，不写比赛库。
"""

import asyncio
import logging
from hashlib import sha256
from inspect import iscoroutinefunction
from urllib.parse import urlsplit

from contest_detective.server.contest.schemas import ContestDraft, PageIn, Source
from contest_detective.server.contest.verification import resolve
from contest_detective.server.research_pipeline.normalization import supported_claims
from contest_detective.server.research_pipeline.official import is_official_page
from contest_detective.server.research_pipeline.pipeline.models import ContestRecord, ContestSyncContext, RetrievedPage
from contest_detective.server.research_pipeline.structured import StructuredCandidate, StructuredDescriptionEnrich, deduplicate_structured

logger = logging.getLogger(__name__)
WECHAT_SITE = 'mp.weixin.qq.com'


def search_query(request) -> str:
    parts = [*request.keywords, request.name or '', request.country or '']
    return ' '.join(part.strip() for part in parts if part and part.strip())


class StructuredCollect:
    """调用聚合站接口。接口本身只返回黑客松，不再按关键词丢弃。"""

    def __init__(self, client, sources=None):
        self._client = client
        self._sources = sources

    def _adapters(self):
        if self._sources is not None:
            return self._sources
        from contest_detective.server.research_pipeline.sources import structured_sources
        return structured_sources()

    async def run(self, ctx: ContestSyncContext) -> None:
        for name, fetch in self._adapters():
            try:
                drafts = await asyncio.to_thread(fetch, self._client)
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Structured source failed source=%s error_type=%s', name, type(exc).__name__)
                continue
            for draft in drafts:
                if _matches_mode(ctx.request.mode, draft):
                    ctx.structured_candidates.append(StructuredCandidate(name, draft))
                    ctx.extracted_items.append(draft)
                else:
                    ctx.skipped += 1


class StructuredEnrich:
    def __init__(self, searcher=None):
        self._stage = StructuredDescriptionEnrich(searcher)

    async def run(self, ctx: ContestSyncContext) -> None:
        await self._stage.run(ctx.structured_candidates)


class StructuredDeduplicate:
    async def run(self, ctx: ContestSyncContext) -> None:
        ctx.structured_candidates = deduplicate_structured(ctx.structured_candidates)
        ctx.extracted_items = [candidate.draft for candidate in ctx.structured_candidates]


class StructuredNormalize:
    def __init__(self, normalizer):
        self._normalizer = normalizer

    async def run(self, ctx: ContestSyncContext) -> None:
        from contest_detective.server.research_pipeline.normalization import NormalizationInput
        normalized = []
        for candidate in ctx.structured_candidates:
            source_key = sha256(candidate.draft.page.url.encode('utf-8')).hexdigest()[:16]
            try:
                context_page = candidate.evidence_page
                item = NormalizationInput(
                    draft=candidate.draft,
                    context=candidate.context,
                    context_url=context_page.url,
                )
                original_claims = set(candidate.claim_pages)
                candidate.draft = await self._normalizer(item)
                candidate.claim_pages = {
                    id(claim): candidate.claim_pages.get(id(claim), context_page)
                    for claim in candidate.draft.claims
                }
                logger.info('Structured normalization completed source=%s added_claims=%s source_key=%s',
                            candidate.source, len(set(candidate.claim_pages) - original_claims), source_key)
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Structured normalization failed error_type=%s source=%s source_key=%s',
                               type(exc).__name__, candidate.source, source_key)
            normalized.append(candidate.draft)
        ctx.extracted_items = normalized


def web_search():
    """已装配的元宝与 Tavily 检索。元宝优先，两者都配置时由混合搜索合并。"""
    from contest_detective.server.research_pipeline import search_web
    return search_web


WECHAT_TERMS = ('黑客松 报名', '黑客松 延期', '黑客松 提交截止')


class PageRetrieve:
    """检索链接、标题和摘要。默认使用元宝与 Tavily；列表页解析由具体来源函数提供。"""

    def __init__(self, searcher=None, listings=None, client=None):
        self._searcher = searcher if searcher is not None else web_search()
        self._listings = listings
        self._client = client

    async def run(self, ctx: ContestSyncContext) -> None:
        seen = set()
        queries = [(search_query(ctx.request), None), *((term, WECHAT_SITE) for term in WECHAT_TERMS)]
        for query, site in queries:
            try:
                hits = await asyncio.to_thread(self._searcher, query, site=site, count=10)
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Page search failed error_type=%s', type(exc).__name__)
                continue
            for hit in hits:
                url = _wechat_url(hit.url) if site == WECHAT_SITE else hit.url
                if url is None or url in seen:
                    continue
                seen.add(url)
                ctx.retrieved_pages.append(RetrievedPage(
                    url=url, title=hit.title or url, content=hit.snippet or '',
                ))
        for name, listing in self._listing_adapters():
            try:
                urls = await listing(ctx)
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Listing discovery failed source=%s error_type=%s', name, type(exc).__name__)
                continue
            for url in urls:
                if url in seen:
                    continue
                seen.add(url)
                ctx.retrieved_pages.append(RetrievedPage(url=url, title=url))

    def _listing_adapters(self):
        if self._listings is not None:
            return self._listings
        client = self._client

        async def huodongxing(ctx):
            return await _huodongxing_urls(ctx, client)

        async def ethglobal(ctx):
            return await _ethglobal_urls(ctx, client)

        return [('huodongxing', huodongxing), ('ethglobal', ethglobal)]


class PageExtract:
    """补全文并抽取。摘录必须出现在正文里，否则该条草稿不进入待验证。"""

    def __init__(self, extractor, fetcher=None, sleep=None):
        self._extractor = extractor
        self._fetcher = fetcher
        self._sleep = sleep if sleep is not None else asyncio.sleep

    async def run(self, ctx: ContestSyncContext) -> None:
        for page in ctx.retrieved_pages:
            if _polite_host(page.url):
                await self._sleep(2)
            try:
                text = await _page_text(page, self._fetcher)
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Page fetch failed error_type=%s', type(exc).__name__)
                continue
            if not text.strip():
                ctx.skipped += 1
                continue
            try:
                draft = ContestDraft.model_validate(await self._extractor(page.url, text))
            except Exception as exc:
                ctx.failed += 1
                logger.warning('Page extract failed error_type=%s', type(exc).__name__)
                continue
            claims = _supported_claims(text, draft)
            if not claims or not draft.name.strip():
                ctx.skipped += 1
                continue
            host = urlsplit(page.url).hostname or page.url
            ctx.extracted_items.append(draft.model_copy(update={
                'name': draft.name.strip(),
                'page': PageIn(url=page.url, site=host, title=draft.name.strip(),
                               is_official=is_official_page(page.url)),
                'claims': claims,
            }))


class DraftVerify:
    """把同一场比赛的草稿和库里已有出处合并成带核实等级的记录。"""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    async def run(self, ctx: ContestSyncContext) -> None:
        claim_pages = {id(candidate.draft): candidate.claim_pages for candidate in ctx.structured_candidates}
        grouped: dict[tuple, list[ContestDraft]] = {}
        for draft in ctx.extracted_items:
            if not draft.claims:
                ctx.skipped += 1
                continue
            pinned = ctx.contest_by_url.get(draft.page.url)
            key = ('id', pinned) if pinned else _group_key(draft)
            grouped.setdefault(key, []).append(draft)
        for key, drafts in grouped.items():
            contest_id = key[1] if key[0] == 'id' else None
            existing = _existing_sources(self._session_factory, drafts[0], contest_id)
            if contest_id is None and existing:
                contest_id = existing[0]
                existing = existing[1]
            elif existing:
                existing = existing[1]
            incoming = [
                (claim.field, _source(draft, claim, claim_pages.get(id(draft), {}).get(id(claim))))
                for draft in drafts for claim in draft.claims
            ]
            fresh = {(source.url, field) for field, source in incoming}
            carried = [item for item in existing if (item[1].url, item[0]) not in fresh] if existing else []
            fields = {}
            claimed = {field for field, _ in incoming} | {field for field, _ in carried}
            for field in claimed:
                sources = [source for name, source in incoming if name == field]
                sources.extend(source for name, source in carried if name == field)
                fields[field] = resolve(field, sources)
            first = drafts[0]
            ctx.records.append(_record(first, drafts, fields, contest_id))


def _record(first, drafts, fields, contest_id=None):
    return ContestRecord(
        name=first.name,
        cover_url=next((draft.cover_url for draft in drafts if draft.cover_url), None),
        summary=next((draft.summary for draft in drafts if draft.summary), None),
        contest_id=contest_id,
        fields=fields,
    )


def _existing_sources(session_factory, draft, contest_id):
    if session_factory is None:
        return None
    from contest_detective.server.contest.service import claim_sources, match_id
    with session_factory() as session:
        contest_id = contest_id or match_id(session, draft)
        if contest_id is None:
            return None
        return contest_id, claim_sources(session, contest_id)


def _polite_host(url: str) -> bool:
    host = urlsplit(url).hostname or ''
    return host == 'huodongxing.com' or host.endswith('.huodongxing.com') or host.endswith('ethglobal.com')


def _wechat_url(value: str) -> str | None:
    parsed = urlsplit(value)
    if parsed.hostname != WECHAT_SITE or parsed.username or parsed.password:
        return None
    return parsed._replace(scheme='https', fragment='').geturl()


def _matches_mode(mode, draft: ContestDraft) -> bool:
    if mode is None:
        return True
    values = [claim.value for claim in draft.claims if claim.field == 'mode']
    return not values or mode in values


def _supported_claims(text, draft: ContestDraft):
    return supported_claims(text, draft.claims)


def _group_key(draft: ContestDraft):
    from contest_detective.server.contest.identity import normalized_name, start_calendar_date
    return normalized_name(draft.name), start_calendar_date(draft)


def _source(draft: ContestDraft, claim, page: PageIn | None = None) -> Source:
    page = page or draft.page
    return Source(
        url=page.url, site=page.site, title=page.title,
        published_at=page.published_at, is_official=page.is_official,
        value=claim.value, excerpt=claim.excerpt, precision=claim.precision,
    )


async def _page_text(page: RetrievedPage, fetcher) -> str:
    if page.raw_content:
        return page.raw_content
    if fetcher is None:
        from contest_detective.server.research_pipeline.pages import fetch_page
        fetcher = fetch_page
    text = await fetcher(page.url) if iscoroutinefunction(fetcher) else await asyncio.to_thread(fetcher, page.url)
    if text and text.strip():
        page.raw_content = text
        return text
    return page.content


async def _huodongxing_urls(ctx: ContestSyncContext, client) -> list[str]:
    import httpx

    from contest_detective.server.research_pipeline.sources.huodongxing import SEARCH_URL, discover_urls

    term = ctx.request.keywords[0] if ctx.request.keywords else (ctx.request.name or '黑客松')
    owned = client is None
    active = client if client is not None else httpx.Client(timeout=10)
    try:
        response = await asyncio.to_thread(active.get, SEARCH_URL, params={'qs': term})
        response.raise_for_status()
        return discover_urls(response.text)
    finally:
        if owned:
            active.close()


async def _ethglobal_urls(_ctx: ContestSyncContext, client) -> list[str]:
    import httpx

    from contest_detective.server.research_pipeline.sources.ethglobal import EVENTS_URL, discover_urls

    owned = client is None
    active = client if client is not None else httpx.Client(timeout=10)
    try:
        response = await asyncio.to_thread(active.get, EVENTS_URL)
        response.raise_for_status()
        return discover_urls(response.text)
    finally:
        if owned:
            active.close()
