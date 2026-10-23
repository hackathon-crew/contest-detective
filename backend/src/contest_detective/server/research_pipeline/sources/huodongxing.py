"""活动行公开报名页发现；首屏最多八页，每次详情请求前至少等两秒。"""

import asyncio
import logging
import re
from contextlib import nullcontext
from urllib.parse import urljoin, urlsplit

import httpx
from lxml import html

from contest_detective.framework.db import SessionLocal
from contest_detective.server.research_pipeline.record import run
from contest_detective.server.research_pipeline.sources.discovery import DiscoveryReport

SEARCH_URL = 'https://www.huodongxing.com/search'
logger = logging.getLogger(__name__)


def discover_urls(document: str) -> list[str]:
    urls = []
    for href in html.fromstring(document).xpath('//a/@href'):
        try:
            target = urlsplit(urljoin(SEARCH_URL, href))
        except ValueError:
            continue
        if (target.scheme == 'https' and target.hostname in {'huodongxing.com', 'www.huodongxing.com'}
                and not target.username and not target.password and re.fullmatch(r'/event/\d+/?', target.path)):
            url = 'https://www.huodongxing.com' + target.path.rstrip('/')
            if url not in urls:
                urls.append(url)
            if len(urls) == 8:
                break
    return urls


async def sync(*, extractor, session_factory=SessionLocal, client=None,
               sleep=asyncio.sleep, runner=run) -> DiscoveryReport:
    report = DiscoveryReport()
    context = nullcontext(client) if client is not None else httpx.Client(timeout=10, headers={
        'User-Agent': 'ContestDetective/0.1 (+https://github.com/hackathon-crew/contest-detective)',
    })
    with context as active:
        response = await asyncio.to_thread(active.get, SEARCH_URL, params={'qs': '黑客松'})
        response.raise_for_status()
        urls = discover_urls(response.text)
    report.discovered = len(urls)
    for url in urls:
        await sleep(2)
        try:
            if await runner(url, extractor=extractor, session_factory=session_factory) is not None:
                report.saved += 1
            else:
                report.skipped += 1
        except Exception as exc:
            report.failed += 1
            logger.warning('Registration page failed source=huodongxing error_type=%s', type(exc).__name__)
    return report
