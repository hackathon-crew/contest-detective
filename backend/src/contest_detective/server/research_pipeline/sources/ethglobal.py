"""只从官网 Upcoming 黑客松卡片发现详情，历史活动不进入抽取队列。"""

import re
from urllib.parse import urljoin, urlsplit

from lxml import html

EVENTS_URL = 'https://ethglobal.com/events'


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
