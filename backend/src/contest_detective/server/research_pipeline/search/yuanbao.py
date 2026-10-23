import json
from contextlib import nullcontext

import httpx

from contest_detective.server.research_pipeline.search.base import SearchHit


class YuanbaoSearch:
    def __init__(self, *, api_key: str, client: httpx.Client | None = None):
        self._api_key = api_key
        self._client = client

    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]:
        if not 1 <= count <= 50:
            raise ValueError('搜索条数必须在 1 到 50 之间')
        if not self._api_key:
            return []
        body = {'Query': query, 'Cnt': ((count + 9) // 10) * 10}
        if site:
            body['Site'] = site
        context = nullcontext(self._client) if self._client else httpx.Client(timeout=10)
        with context as client:
            response = client.post(
                'https://api.wsa.cloud.tencent.com/SearchPro',
                json=body, headers={'Authorization': f'Bearer {self._api_key}'},
            )
            response.raise_for_status()
        payload = response.json().get('Response', {})
        if payload.get('Error'):
            raise ValueError('搜索服务暂不可用')
        hits = []
        for raw in payload.get('Pages', []):
            try:
                page = json.loads(raw) if isinstance(raw, str) else raw
                url = httpx.URL(page['url'])
                if url.scheme not in {'http', 'https'} or not url.host or url.userinfo:
                    continue
                hits.append(SearchHit(
                    title=page.get('title') or str(url), url=str(url),
                    site=page.get('site') or url.host, date=page.get('date') or None,
                    snippet=page.get('passage') or page.get('content') or '', provider='yuanbao',
                ))
            except (ValueError, TypeError, KeyError):
                continue
        return hits[:count]
