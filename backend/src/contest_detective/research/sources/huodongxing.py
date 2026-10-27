"""活动行公开报名页发现；首屏最多八条。"""

import re
from urllib.parse import urljoin, urlsplit

from lxml import html

SEARCH_URL = 'https://www.huodongxing.com/search'


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
