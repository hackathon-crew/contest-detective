"""Bounded, robots-aware public evidence retrieval without model dependencies."""

import asyncio
import re
import time
import posixpath
from datetime import datetime, timezone
from hashlib import sha256
from inspect import isawaitable, iscoroutinefunction
from urllib.parse import unquote, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from contest_detective.contest.content import ContestDocument, CoverageObservation
from contest_detective.contest.content_service import EXTRACTOR_VERSION, document_key
from contest_detective.contest.schemas import PageIn
from contest_detective.research.detail_contracts import DetailFetchResult, DetailTarget
from contest_detective.research.normalization import supported_claims
from contest_detective.research.official import is_official_page
from contest_detective.research.pages import fetch_page

USER_AGENT = 'ContestDetective'
MAX_TARGETS_PER_CONTEST = 3
MAX_TARGETS_PER_RUN = 150


def document_for(page: PageIn, body: str, *, kind='page', fetch_method='http',
                 completeness='full', now=None) -> ContestDocument:
    return ContestDocument(**page.model_dump(), body=body,
        kind=kind, representation='extracted_text', fetch_method=fetch_method,
        completeness=completeness, content_hash=sha256(body.encode('utf-8')).hexdigest(),
        retrieved_at=now or datetime.now(timezone.utc), extractor_version=EXTRACTOR_VERSION)


def document_page(document: ContestDocument) -> PageIn:
    return PageIn(**{name: getattr(document, name) for name in PageIn.model_fields})


def distinct_documents(documents):
    return list({document_key(doc): doc for doc in documents}.values())


def supporting_documents(documents, claim):
    return [document for document in documents if supported_claims(document.body, [claim])]


def detail_targets(candidate, *, limit=MAX_TARGETS_PER_CONTEST):
    """Known source and registration pages only, plus the documented Devpost rules route."""
    pages = []
    for member in candidate.group or [candidate]:
        pages.append(member.draft.page)
    registrations = [claim.value for claim in candidate.draft.claims if claim.field == 'registration_url']
    for url in registrations:
        known = next((page for page in pages if page.url == url), None)
        pages.append(known or PageIn(url=url, site=urlsplit(url).hostname or url,
            title=candidate.draft.name, is_official=is_official_page(url, registration_url=url)))
    for page in list(pages):
        parsed = urlsplit(page.url)
        if (parsed.hostname or '').endswith('.devpost.com'):
            rules = parsed._replace(path='/rules', query='', fragment='').geturl()
            pages.append(page.model_copy(update={'url': rules}))
    seen, targets = set(), []
    for page in pages:
        key = page.url.rstrip('/')
        if key in seen:
            continue
        seen.add(key)
        targets.append(DetailTarget(page=page, contest_name=candidate.draft.name,
            purpose='rules' if urlsplit(page.url).path.rstrip('/') == '/rules' else 'detail'))
    if len(targets) > MAX_TARGETS_PER_CONTEST:
        # Aggregator duplicates must not consume the entire budget before known rules.
        targets.sort(key=lambda target: (0 if target.page.url in registrations else
            1 if target.purpose == 'rules' else 2, not target.page.is_official))
    return targets if limit is None else targets[:limit]


def _deny_route(url):
    parsed = urlsplit(url)
    host = (parsed.hostname or '').lower().rstrip('.')
    path = parsed.path
    for _ in range(3):
        path = unquote(path)
    path = posixpath.normpath(path.replace('\\', '/'))
    # Existing adapters are separate. This new public-page path never accesses their APIs.
    if any(host == domain or host.endswith('.' + domain)
           for domain in ('events.waytoagi.com', 'hackertrip.space')) and path.startswith('/api'):
        raise PermissionError('denied_api_route')


def _extra_robots_rules(text):
    """Conservative handling for wildcard paths and fractional crawl delays."""
    agents, rules, delays = [], [], []
    in_rules = False
    for line in text.splitlines():
        line = line.split('#', 1)[0].strip()
        if ':' not in line:
            continue
        key, value = (part.strip() for part in line.split(':', 1))
        key = key.lower()
        if key == 'user-agent':
            if in_rules:
                agents = []
            in_rules = False
            agents.append(value.lower())
            continue
        in_rules = True
        applicable = any(agent == '*' or agent in USER_AGENT.lower() for agent in agents)
        if not applicable:
            continue
        if key == 'disallow' and value:
            suffix = '$' if value.endswith('$') else ''
            value = value.removesuffix('$')
            rules.append(re.compile('^' + re.escape(value).replace(r'\*', '.*') + suffix))
        elif key == 'crawl-delay':
            try:
                delays.append(float(value))
            except ValueError:
                raise PermissionError('robots_unreadable') from None
    return rules, max(delays, default=0)


class BoundedPublicDetailFetcher:
    """Two transient attempts, fail-closed robots checks, and checks on every redirect."""

    def __init__(self, *, client=None, resolver=None, sleep=None, now=None, polite_sleep=None):
        self._client = client
        self._resolver = resolver
        self._sleep = sleep or asyncio.sleep
        self._now = now
        self._robots = {}
        self._last_request = {}
        self._polite_sleep = polite_sleep or time.sleep

    def reset_run(self):
        self._robots.clear()
        self._last_request.clear()

    def _policy(self, url):
        _deny_route(url)
        parsed = urlsplit(url)
        origin = f'{parsed.scheme}://{parsed.netloc}'
        if origin not in self._robots:
            robots_url = origin + '/robots.txt'
            parser = RobotFileParser(robots_url)
            try:
                text = fetch_page(robots_url, client=self._client, resolver=self._resolver,
                    before_request=_deny_route)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in {404, 410}:
                    text = ''
                elif exc.response.status_code in {401, 403}:
                    raise PermissionError('robots_denied') from exc
                else:
                    raise
            if text.strip() and 'user-agent:' not in text.lower():
                raise PermissionError('robots_unreadable')
            parser.parse(text.splitlines())
            rules, delay = _extra_robots_rules(text)
            self._robots[origin] = parser, rules, delay
        parser, rules, extra_delay = self._robots[origin]
        path = parsed.path + ('?' + parsed.query if parsed.query else '')
        if not parser.can_fetch(USER_AGENT, url) or any(rule.match(path) for rule in rules):
            raise PermissionError('robots_denied')
        # A required slow crawl is not silently ignored or shortened.
        delay = max(parser.crawl_delay(USER_AGENT) or 0, extra_delay)
        if delay > 2:
            raise PermissionError('robots_crawl_delay_exceeds_run_budget')
        remaining = max(delay, 0.25) - (time.monotonic() - self._last_request.get(origin, 0))
        if remaining > 0:
            self._polite_sleep(remaining)
        self._last_request[origin] = time.monotonic()

    def _fetch(self, target):
        resolved = []
        body = fetch_page(target.page.url, client=self._client, resolver=self._resolver,
            before_request=self._policy, resolved_url=resolved)
        if not body.strip():
            raise ValueError('empty_body')
        final_url = resolved[-1] if resolved else target.page.url
        page = target.page
        if final_url != page.url:
            same_host = urlsplit(final_url).hostname == urlsplit(page.url).hostname
            page = PageIn(url=final_url,
                site=page.site if same_host else urlsplit(final_url).hostname or final_url,
                title=page.title, published_at=page.published_at if same_host else None,
                is_official=page.is_official if same_host else is_official_page(final_url))
        return document_for(page, body, now=self._now)

    async def __call__(self, target: DetailTarget) -> DetailFetchResult:
        reason = 'fetch_failed'
        for attempt in range(2):
            try:
                # A small host-independent delay also satisfies crawl-delay <= 2.
                await self._sleep(2)
                document = await asyncio.to_thread(self._fetch, target)
                return DetailFetchResult(document=document, coverage=CoverageObservation(
                    state='found', urls=[document.url], checked_at=document.retrieved_at))
            except Exception as exc:
                reason = str(exc) if isinstance(exc, PermissionError) else type(exc).__name__
                transient = isinstance(exc, (httpx.TimeoutException, httpx.TransportError)) or (
                    isinstance(exc, httpx.HTTPStatusError) and
                    (exc.response.status_code == 429 or exc.response.status_code >= 500))
                if not transient or attempt == 1:
                    break
        return DetailFetchResult(coverage=CoverageObservation(state='fetch_failed',
            urls=[target.page.url], checked_at=self._now or datetime.now(timezone.utc), reason=reason))


async def call_detail_fetcher(fetcher, target):
    if iscoroutinefunction(fetcher) or iscoroutinefunction(getattr(fetcher, '__call__', None)):
        result = fetcher(target)
    else:
        result = await asyncio.to_thread(fetcher, target)
    result = await result if isawaitable(result) else result
    result = DetailFetchResult.model_validate(result)
    if result.document is not None:
        from contest_detective.contest.content_service import validate_document
        validate_document(result.document)
    return result


def safe_page_reader(fetcher):
    """Use the same public-access policy for legacy text-only verification ports."""
    async def read(url):
        page = PageIn(url=url, site=urlsplit(url).hostname or url, title=url,
            is_official=is_official_page(url))
        result = await call_detail_fetcher(fetcher, DetailTarget(page=page, contest_name=url))
        if result.document is None:
            raise PermissionError(result.coverage.reason or 'public_detail_unavailable')
        if urlsplit(result.document.url).hostname != urlsplit(url).hostname:
            raise PermissionError('redirect_source_requires_document_pipeline')
        return result.document.body
    return read
