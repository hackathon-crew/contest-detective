"""同步管道的具体环节。

结构化来源把接口草稿写入 ``extracted_items``。
非结构化来源先写 ``retrieved_pages``，抽取后再进入 ``extracted_items``。
验证只合并本轮草稿，不写比赛库。
"""

import asyncio
import logging
from datetime import datetime, timezone
from hashlib import sha256
from inspect import iscoroutinefunction
from urllib.parse import urlsplit
from typing import get_args

from contest_detective.contest.content import ContentCitation, ContentCoverage, CoverageObservation
from contest_detective.contest.schemas import ContestDraft, ContestField, PageIn, Source
from contest_detective.contest.verification import resolve
from contest_detective.research.normalization import supported_claims
from contest_detective.research.detail import (
    MAX_TARGETS_PER_CONTEST, MAX_TARGETS_PER_RUN, call_detail_fetcher, detail_targets, distinct_documents,
    document_for, document_page, supporting_documents,
)
from contest_detective.research.refresh.contracts import RefreshFailure, SourceInventory
from contest_detective.research.official import is_official_page
from contest_detective.research.pipeline.models import ContestRecord, ContestSyncContext, RetrievedPage
from contest_detective.research.structured import StructuredCandidate, StructuredDescriptionEnrich, deduplicate_structured

logger = logging.getLogger(__name__)
WECHAT_SITE = 'mp.weixin.qq.com'


def _count(ctx, stage, outcome, number=1):
    counts = ctx.stage_counts.setdefault(stage, {})
    counts[outcome] = counts.get(outcome, 0) + number


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
        from contest_detective.research.sources import structured_sources
        return structured_sources()

    async def run(self, ctx: ContestSyncContext) -> None:
        for name, fetch in self._adapters():
            _count(ctx, 'source', 'attempted')
            try:
                drafts = await asyncio.to_thread(fetch, self._client)
            except Exception as exc:
                ctx.failed += 1
                _count(ctx, 'source', 'failed')
                ctx.source_inventory.append(SourceInventory(source=name, failed=1,
                    termination='failed', reason=type(exc).__name__))
                ctx.failures.append(RefreshFailure(key=name, stage='fetch', reason=type(exc).__name__))
                logger.warning('Structured source failed source=%s error_type=%s', name, type(exc).__name__)
                continue
            inventory = getattr(drafts, 'inventory', None)
            if inventory is not None:
                ctx.source_inventory.append(inventory)
                ctx.failed += inventory.failed
                _count(ctx, 'source', 'failed', inventory.failed)
                if inventory.failed:
                    ctx.failures.append(RefreshFailure(key=name, stage='fetch',
                        reason=inventory.reason or 'partial_source_failure'))
            else:
                ctx.source_inventory.append(SourceInventory(source=name, discovered=len(drafts),
                    fetched=len(drafts), termination='exhausted'))
            _count(ctx, 'source', 'fetched', len(drafts))
            for draft in drafts:
                if _matches_mode(ctx.request.mode, draft):
                    candidate = StructuredCandidate(name, draft)
                    ctx.structured_candidates.append(candidate)
                    if any(item.reason == 'source_body_exceeds_size_limit'
                           for item in candidate.draft.coverage.sources.values()):
                        ctx.failed += 1
                        _count(ctx, 'source', 'extract_failed')
                        ctx.failures.append(RefreshFailure(key=draft.name, stage='extract',
                            url=draft.page.url, reason='source_body_exceeds_size_limit'))
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


class StructuredDetail:
    """Read known public detail pages even when an adapter description already exists."""

    def __init__(self, fetcher, *, limit=MAX_TARGETS_PER_RUN):
        self._fetcher = fetcher
        self._limit = limit

    async def run(self, ctx: ContestSyncContext) -> None:
        from contest_detective.contest.content_service import build_introduction

        if hasattr(self._fetcher, 'reset_run'):
            self._fetcher.reset_run()
        cache = {}
        for candidate in ctx.structured_candidates:
            coverage = candidate.draft.coverage.model_copy(deep=True)
            documents = list(candidate.draft.documents)
            candidate.detail_attempted = True
            for index, target in enumerate(detail_targets(candidate, limit=None)):
                url = target.page.url
                if index >= MAX_TARGETS_PER_CONTEST:
                    coverage.sources[url] = CoverageObservation(state='not_fetched', urls=[url],
                        reason='detail_event_limit')
                    _count(ctx, 'detail', 'bounded')
                    continue
                if url not in cache and len(cache) >= self._limit:
                    coverage.sources[url] = CoverageObservation(state='not_fetched', urls=[url],
                        reason='detail_run_limit')
                    _count(ctx, 'detail', 'bounded')
                    continue
                if url not in cache:
                    _count(ctx, 'detail', 'attempted')
                    try:
                        cache[url] = await call_detail_fetcher(self._fetcher, target)
                    except Exception as exc:
                        from contest_detective.research.detail_contracts import DetailFetchResult
                        cache[url] = DetailFetchResult(coverage=CoverageObservation(
                            state='fetch_failed', urls=[url], checked_at=datetime.now(timezone.utc),
                            reason=type(exc).__name__))
                    result = cache[url]
                    if result.document is None:
                        ctx.failed += 1
                        _count(ctx, 'detail', 'failed')
                        ctx.failures.append(RefreshFailure(key=candidate.draft.name, stage='fetch',
                            url=url, reason=result.coverage.reason or 'detail_fetch_failed'))
                    else:
                        _count(ctx, 'detail', 'fetched')
                result = cache[url]
                coverage.sources[url] = result.coverage
                if result.document is not None:
                    documents.append(result.document)
            documents = distinct_documents(documents)
            genuine = [doc for doc in documents if doc.kind != 'search_snippet']
            genuine.sort(key=lambda doc: (not doc.is_official, doc.kind != 'page'))
            introduction = next((intro for doc in genuine if (intro := build_introduction(doc))),
                                candidate.draft.introduction)
            if introduction is not None:
                coverage.introduction = CoverageObservation(state='found',
                    urls=[citation.url for citation in introduction.citations],
                    citations=introduction.citations, checked_at=datetime.now(timezone.utc))
            elif coverage.sources and all(item.state == 'fetch_failed' for item in coverage.sources.values()):
                coverage.introduction = CoverageObservation(state='fetch_failed',
                    urls=list(coverage.sources), reason='detail_fetch_failed')
            existing_fields = {claim.field for claim in candidate.draft.claims}
            for name in get_args(ContestField):
                if name not in existing_fields and name not in coverage.fields:
                    coverage.fields[name] = CoverageObservation(state='not_fetched',
                        urls=list(coverage.sources), reason='field_extraction_not_run')
            candidate.draft = candidate.draft.model_copy(update={
                'documents': documents, 'introduction': introduction, 'coverage': coverage,
            })
        ctx.extracted_items = [candidate.draft for candidate in ctx.structured_candidates]


class StructuredNormalize:
    def __init__(self, normalizer):
        self._normalizer = normalizer

    async def run(self, ctx: ContestSyncContext) -> None:
        from contest_detective.research.normalization import NormalizationInput
        normalized = []
        for candidate in ctx.structured_candidates:
            _count(ctx, 'normalize', 'attempted')
            source_key = sha256(candidate.draft.page.url.encode('utf-8')).hexdigest()[:16]
            try:
                context_page = candidate.evidence_page
                documents = candidate.draft.documents if candidate.detail_attempted else []
                context = candidate.context
                if documents:
                    # One existing governed normalizer invocation, not one call per document.
                    context = '\n\n'.join(f'来源：{doc.url}\n{doc.body}' for doc in documents)
                item = NormalizationInput(
                    draft=candidate.draft,
                    context=context,
                    context_url=context_page.url,
                    allow_conflicts=bool(documents),
                )
                original_claims = set(candidate.claim_pages)
                candidate.draft = await self._normalizer(item)
                owners, claims = {}, []
                for claim in candidate.draft.claims:
                    if id(claim) in candidate.claim_pages:
                        owners[id(claim)] = candidate.claim_pages[id(claim)]
                        claims.append(claim)
                        continue
                    matches = supporting_documents(documents, claim) if documents else []
                    if documents and not matches:
                        continue
                    for index, page in enumerate([document_page(doc) for doc in matches] or [context_page]):
                        owned = claim if index == 0 else claim.model_copy()
                        owners[id(owned)] = page
                        claims.append(owned)
                candidate.claim_pages = owners
                coverage = candidate.draft.coverage.model_copy(deep=True)
                if documents:
                    claimed = {claim.field for claim in claims}
                    complete = [doc for doc in documents if doc.kind == 'page' and doc.completeness == 'full']
                    for name in get_args(ContestField):
                        if name not in claimed:
                            coverage.fields[name] = CoverageObservation(
                                state='not_found_in_source' if complete else 'not_fetched',
                                urls=list(dict.fromkeys(doc.url for doc in complete or documents)),
                                checked_at=datetime.now(timezone.utc),
                                reason='checked_complete_page_text' if complete else 'only_partial_evidence_available')
                candidate.draft = candidate.draft.model_copy(update={'claims': claims, 'coverage': coverage})
                _count(ctx, 'normalize', 'extracted')
                logger.info('Structured normalization completed source=%s added_claims=%s source_key=%s',
                            candidate.source, len(set(candidate.claim_pages) - original_claims), source_key)
            except Exception as exc:
                ctx.failed += 1
                _count(ctx, 'normalize', 'failed')
                ctx.failures.append(RefreshFailure(key=candidate.draft.name, stage='extract',
                    url=candidate.draft.page.url, reason=type(exc).__name__))
                coverage = candidate.draft.coverage.model_copy(deep=True)
                for name in get_args(ContestField):
                    if not any(claim.field == name for claim in candidate.draft.claims):
                        coverage.fields[name] = CoverageObservation(state='extract_failed',
                            urls=[doc.url for doc in candidate.draft.documents], reason=type(exc).__name__)
                candidate.draft = candidate.draft.model_copy(update={'coverage': coverage})
                logger.warning('Structured normalization failed error_type=%s source=%s source_key=%s',
                               type(exc).__name__, candidate.source, source_key)
            normalized.append(candidate.draft)
        ctx.extracted_items = normalized


def web_search():
    """已装配的元宝与 Tavily 检索。元宝优先，两者都配置时由混合搜索合并。"""
    from contest_detective.research import search_web
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
            _count(ctx, 'page', 'attempted')
            if _polite_host(page.url):
                await self._sleep(2)
            try:
                text = await _page_text(page, self._fetcher)
            except Exception as exc:
                ctx.failed += 1
                _count(ctx, 'page', 'fetch_failed')
                ctx.failures.append(RefreshFailure(key=page.title or page.url, stage='fetch',
                    url=page.url, reason=type(exc).__name__))
                logger.warning('Page fetch failed error_type=%s', type(exc).__name__)
                continue
            if not text.strip():
                ctx.skipped += 1
                continue
            try:
                draft = ContestDraft.model_validate(await self._extractor(page.url, text))
            except Exception as exc:
                ctx.failed += 1
                _count(ctx, 'page', 'extract_failed')
                ctx.failures.append(RefreshFailure(key=page.title or page.url, stage='extract',
                    url=page.url, reason=type(exc).__name__))
                logger.warning('Page extract failed error_type=%s', type(exc).__name__)
                continue
            claims = _supported_claims(text, draft)
            if not claims or not draft.name.strip():
                ctx.skipped += 1
                continue
            host = urlsplit(page.url).hostname or page.url
            source_page = PageIn(url=page.url, site=host, title=draft.name.strip(),
                is_official=is_official_page(page.url))
            is_body = bool(page.raw_content)
            document = document_for(source_page, text,
                kind='page' if is_body else 'search_snippet',
                fetch_method='http' if is_body else 'cached_web_excerpt',
                completeness='full' if is_body else 'partial')
            from contest_detective.contest.content_service import build_introduction
            _count(ctx, 'page', 'extracted')
            ctx.extracted_items.append(draft.model_copy(update={
                'name': draft.name.strip(),
                'page': source_page,
                'claims': claims,
                'documents': [document],
                'introduction': build_introduction(document) if is_body else None,
                'coverage': ContentCoverage(),
                'themes': None,
            }))


class DraftVerify:
    """把同一场比赛的草稿和库里已有出处合并成带核实等级的记录。"""

    def __init__(self, session_factory=None):
        self._session_factory = session_factory

    async def run(self, ctx: ContestSyncContext) -> None:
        claim_pages = {id(candidate.draft): candidate.claim_pages for candidate in ctx.structured_candidates}
        theme_pages = {id(candidate.draft): candidate.theme_pages for candidate in ctx.structured_candidates}
        grouped: dict[tuple, list[ContestDraft]] = {}
        for draft in ctx.extracted_items:
            if not draft.claims and not draft.documents and draft.introduction is None:
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
            documents = distinct_documents([doc for draft in drafts for doc in draft.documents])
            exact = {(field, source.url, source.value, source.precision, source.excerpt)
                     for field, source in incoming}
            carried = []
            for field, source in existing or []:
                current = [doc for doc in documents if doc.url == source.url and doc.kind != 'search_snippet']
                supported = any(' '.join(source.excerpt.split()) and
                    ' '.join(source.excerpt.split()) in ' '.join(doc.body.split()) for doc in current)
                duplicate = (field, source.url, source.value, source.precision, source.excerpt) in exact
                # Fresh body evidence can retain another supported value from this same page.
                full_body_checked = any(doc.kind == 'page' and doc.completeness == 'full' for doc in current)
                keep = supported if full_body_checked else (source.url, field) not in fresh or supported
                if not duplicate and keep:
                    carried.append((field, source))
            fields = {}
            claimed = {field for field, _ in incoming} | {field for field, _ in carried}
            for field in claimed:
                sources = [source for name, source in incoming if name == field]
                sources.extend(source for name, source in carried if name == field)
                fields[field] = resolve(field, sources)
            first = drafts[0]
            themes = {}
            for draft in drafts:
                themes.update(theme_pages.get(id(draft), {draft.page.url: draft.themes}
                    if draft.themes is not None else {}))
            ctx.records.append(_record(first, drafts, fields, contest_id, theme_pages=themes))


def _record(first, drafts, fields, contest_id=None, *, theme_pages=None):
    documents = distinct_documents([doc for draft in drafts for doc in draft.documents])
    coverage = ContentCoverage()
    for draft in drafts:
        coverage.sources.update(draft.coverage.sources)
        coverage.fields.update(draft.coverage.fields)
        if draft.coverage.introduction.state != 'not_fetched':
            coverage.introduction = draft.coverage.introduction
    for name, value in fields.items():
        citations = []
        for source in value.sources:
            excerpt = ' '.join(source.excerpt.split())
            for document in documents:
                if excerpt and document.url == source.url and excerpt in ' '.join(document.body.split()):
                    citations.append(ContentCitation(url=source.url, content_hash=document.content_hash,
                        excerpt=source.excerpt))
        coverage.fields[name] = CoverageObservation(state='conflict' if value.level == 'conflict' else 'found',
            urls=list(dict.fromkeys(source.url for source in value.sources)),
            checked_at=datetime.now(timezone.utc), citations=citations)
    return ContestRecord(
        name=first.name,
        cover_url=next((draft.cover_url for draft in drafts if draft.cover_url), None),
        summary=next((draft.summary for draft in drafts if draft.summary), None),
        contest_id=contest_id,
        fields=fields,
        documents=documents,
        introduction=next((draft.introduction for draft in drafts if draft.introduction), None),
        coverage=coverage,
        themes=(list(dict.fromkeys(theme for draft in drafts for theme in (draft.themes or [])))
                if any(draft.themes is not None for draft in drafts) else None),
        theme_pages=theme_pages or {},
    )


def _existing_sources(session_factory, draft, contest_id):
    if session_factory is None:
        return None
    from contest_detective.contest.service import claim_sources, match_id
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
    from contest_detective.contest.identity import normalized_name, start_calendar_date
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
        from contest_detective.research.pages import fetch_page
        fetcher = fetch_page
    text = await fetcher(page.url) if iscoroutinefunction(fetcher) else await asyncio.to_thread(fetcher, page.url)
    if text and text.strip():
        page.raw_content = text
        return text
    return page.content


async def _huodongxing_urls(ctx: ContestSyncContext, client) -> list[str]:
    import httpx

    from contest_detective.research.sources.huodongxing import SEARCH_URL, discover_urls

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

    from contest_detective.research.sources.ethglobal import EVENTS_URL, discover_urls

    owned = client is None
    active = client if client is not None else httpx.Client(timeout=10)
    try:
        response = await asyncio.to_thread(active.get, EVENTS_URL)
        response.raise_for_status()
        return discover_urls(response.text)
    finally:
        if owned:
            active.close()
