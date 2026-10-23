"""固定词只搜索公众号文章；搜索命中不自动证明发布者是主办方。"""

import asyncio
import logging
from urllib.parse import urlsplit, urlunsplit

from contest_detective.framework.db import SessionLocal
from contest_detective.server.research_pipeline.record import run
from contest_detective.server.research_pipeline.sources.discovery import DiscoveryReport

TERMS = ('黑客松 报名', '黑客松 延期', '黑客松 提交截止')
SITE = 'mp.weixin.qq.com'
logger = logging.getLogger(__name__)


def _article_url(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if (parsed.scheme not in {'http', 'https'} or parsed.hostname != SITE
                or parsed.username or parsed.password or parsed.port not in {None, 80, 443}):
            return None
        return urlunsplit(('https', SITE, parsed.path, parsed.query, ''))
    except ValueError:
        return None


async def sync(*, extractor, session_factory=SessionLocal, searcher=None, runner=run) -> DiscoveryReport:
    if searcher is None:
        from contest_detective.server.research_pipeline import search_web
        searcher = search_web
    report = DiscoveryReport()
    seen = set()
    for term in TERMS:
        try:
            hits = await asyncio.to_thread(searcher, term, site=SITE, count=10)
        except Exception as exc:
            report.failed += 1
            logger.warning('Announcement search failed error_type=%s', type(exc).__name__)
            continue
        for hit in hits:
            url = _article_url(hit.url)
            if url is None or url in seen:
                continue
            seen.add(url)
            report.discovered += 1
            try:
                saved = await runner(url, extractor=extractor, session_factory=session_factory)
                if saved is not None:
                    report.saved += 1
                else:
                    report.skipped += 1
            except Exception as exc:
                report.failed += 1
                logger.warning('Announcement page failed error_type=%s', type(exc).__name__)
    return report
