"""只从官网 Upcoming 黑客松卡片发现详情，历史活动不进入抽取队列。"""

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

EVENTS_URL = 'https://ethglobal.com/events'
logger = logging.getLogger(__name__)


def discover_urls(document: str) -> list[str]:
    if not document.strip():
        return []
    urls = []
    tree = html.fromstring(document)
    for section in tree.xpath('//h2[normalize-space(text())="Upcoming"]/parent::*'):
        for card in section.xpath('.//a[@href]'):
            if not re.search(r'\bhackathon\b', ' '.join(card.itertext()), re.I):
                continue
            try:
                target = urlsplit(urljoin(EVENTS_URL, card.get('href')))
                allowed = (target.scheme == 'https' and target.hostname in {'ethglobal.com', 'www.ethglobal.com'}
                    and target.port in {None, 443} and not target.username and not target.password
                    and re.fullmatch(r'/events/[a-z0-9][a-z0-9-]*/?', target.path))
            except ValueError:
                continue
            if allowed:
                url = 'https://ethglobal.com' + target.path.rstrip('/')
                if url not in urls:
                    urls.append(url)
                if len(urls) == 8:
                    return urls
    return urls


async def sync(*, extractor, session_factory=SessionLocal, client=None,
               sleep=asyncio.sleep, runner=run) -> DiscoveryReport:
    report = DiscoveryReport()
    if extractor is None:
        return report
    context = nullcontext(client) if client is not None else httpx.Client(timeout=10, headers={
        'User-Agent': 'ContestDetective/0.1 (+https://github.com/hackathon-crew/contest-detective)',
    })
    with context as active:
        response = await asyncio.to_thread(active.get, EVENTS_URL)
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
            logger.warning('Registration page failed source=ethglobal error_type=%s', type(exc).__name__)
    return report
