import logging
from itertools import zip_longest

import httpx

from contest_detective.server.research_pipeline.search.base import SearchHit, SearchProvider

logger = logging.getLogger(__name__)


class MixedSearch:
    def __init__(self, yuanbao: SearchProvider, others: list[SearchProvider] | None = None):
        self.providers = [yuanbao, *(others or [])]

    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]:
        if not 1 <= count <= 50:
            raise ValueError('搜索条数必须在 1 到 50 之间')
        batches = []
        for provider in self.providers:
            try:
                batches.append(provider.search(query, site=site, count=count))
            except (httpx.HTTPError, ValueError):
                logger.warning('Search provider failed: %s', type(provider).__name__)
        if not batches:
            raise ValueError('所有搜索服务暂时不可用')
        seen = set()
        hits = []
        for group in zip_longest(*batches):
            for hit in group:
                if hit is not None and hit.url not in seen:
                    seen.add(hit.url)
                    hits.append(hit)
        return hits[:count]
