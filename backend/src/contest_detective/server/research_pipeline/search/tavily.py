from contextlib import nullcontext

import httpx

from contest_detective.server.research_pipeline.search.base import SearchHit


class TavilySearch:
    def __init__(self, *, api_key: str, client: httpx.Client | None = None):
        self._api_key = api_key
        self._client = client

    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]:
        if not 1 <= count <= 50:
            raise ValueError('搜索条数必须在 1 到 50 之间')
        if not self._api_key:
            return []
        body = {'query': query, 'search_depth': 'basic', 'max_results': min(count, 20),
                'include_answer': False, 'include_raw_content': False, 'auto_parameters': False}
        if site:
            exclude = site.startswith('exclude:')
            domains = site.removeprefix('exclude:').split('|') if exclude else site.split('|')
            body['exclude_domains' if exclude else 'include_domains'] = [item for item in domains if item]
        context = nullcontext(self._client) if self._client is not None else httpx.Client(timeout=10)
        with context as client:
            response = client.post('https://api.tavily.com/search', json=body,
                                   headers={'Authorization': f'Bearer {self._api_key}'})
            response.raise_for_status()
        payload = response.json()
        if payload.get('error') or payload.get('detail'):
            raise ValueError('搜索服务暂时不可用')
        hits = []
        for raw in payload.get('results', []):
            try:
                url = httpx.URL(raw['url'])
                if url.scheme not in {'http', 'https'} or not url.host or url.userinfo:
                    continue
                hits.append(SearchHit(title=raw.get('title') or str(url), url=str(url), site=url.host,
                                      date=raw.get('published_date') or None,
                                      snippet=raw.get('content') or '', provider='tavily'))
            except (ValueError, TypeError, KeyError):
                continue
        return hits[:min(count, 20)]
