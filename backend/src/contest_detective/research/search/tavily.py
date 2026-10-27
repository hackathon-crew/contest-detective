from urllib.parse import urlparse

from tavily import TavilyClient

from contest_detective.research.search.base import SearchHit


def _valid_http_url(raw: str) -> str | None:
    try:
        parsed = urlparse(raw)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
            return None
        return raw
    except ValueError:
        return None


class TavilySearch:
    def __init__(self, *, api_key: str, client: TavilyClient | None = None):
        self._api_key = api_key
        self._client = client

    def _sdk(self) -> TavilyClient:
        if self._client is not None:
            return self._client
        return TavilyClient(api_key=self._api_key)

    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]:
        if not 1 <= count <= 50:
            raise ValueError('搜索条数必须在 1 到 50 之间')
        if not self._api_key:
            return []
        kwargs = {
            'query': query,
            'search_depth': 'basic',
            'max_results': min(count, 20),
            'include_answer': False,
            'include_raw_content': False,
            'auto_parameters': False,
            'timeout': 10,
        }
        if site:
            exclude = site.startswith('exclude:')
            domains = site.removeprefix('exclude:').split('|') if exclude else site.split('|')
            key = 'exclude_domains' if exclude else 'include_domains'
            kwargs[key] = [item for item in domains if item]
        payload = self._sdk().search(**kwargs)
        if payload.get('error') or payload.get('detail'):
            raise ValueError('搜索服务暂时不可用')
        hits = []
        for raw in payload.get('results', []):
            try:
                url = _valid_http_url(raw['url'])
                if url is None:
                    continue
                host = urlparse(url).hostname or url
                hits.append(SearchHit(title=raw.get('title') or url, url=url, site=host,
                                      date=raw.get('published_date') or None,
                                      snippet=raw.get('content') or '', provider='tavily'))
            except (ValueError, TypeError, KeyError):
                continue
        return hits[:min(count, 20)]
