from __future__ import annotations

from contest_detective.framework.config.search import get_search_settings


def _secret(value) -> str:
    return value.get_secret_value() if value and value.get_secret_value() else ''


def yuanbao_available(config=None) -> bool:
    config = config or get_search_settings()
    return bool(_secret(config.yuanbao_secret_id) and _secret(config.yuanbao_secret_key))


def web_search_available(config=None) -> bool:
    config = config or get_search_settings()
    yuanbao = _secret(config.yuanbao_secret_id) and _secret(config.yuanbao_secret_key)
    return bool(yuanbao or _secret(config.tavily_api_key))


def search_web(query: str, site: str | None = None, count: int = 10, *, config=None, require_yuanbao: bool = False) -> list[SearchHit]:
    # Load provider classes only on the search execution path; retain monkeypatchable exports.
    for name in ('SearchHit', 'MixedSearch', 'YuanbaoSearch', 'TavilySearch'):
        if name not in globals():
            globals()[name] = __getattr__(name)
    config = config or get_search_settings()
    providers = []
    secret_id, secret_key = _secret(config.yuanbao_secret_id), _secret(config.yuanbao_secret_key)
    if require_yuanbao:
        if not secret_id or not secret_key:
            raise ValueError('实时核验需要完整的元宝搜索配置')
        hits = YuanbaoSearch(secret_id=secret_id, secret_key=secret_key).search(query, site=site, count=count)
        if any(hit.provider != 'yuanbao' for hit in hits):
            raise ValueError('元宝执行来源不匹配，未完成实时核验')
        return hits
    if secret_id and secret_key:
        providers.append(YuanbaoSearch(secret_id=secret_id, secret_key=secret_key))
    tavily_key = _secret(config.tavily_api_key)
    if tavily_key:
        providers.append(TavilySearch(api_key=tavily_key))
    if not providers:
        return []
    return MixedSearch(providers[0], providers[1:]).search(query, site=site, count=count)


__all__ = ['SearchHit', 'fetch_page', 'run', 'search_web', 'web_search_available', 'yuanbao_available']


def __getattr__(name):
    # Contract/offline imports must not initialize databases or load providers.
    if name == 'fetch_page':
        from contest_detective.server.research_pipeline.pages import fetch_page
        return fetch_page
    if name in {'SearchHit', 'MixedSearch', 'YuanbaoSearch', 'TavilySearch'}:
        from importlib import import_module
        return getattr(import_module('contest_detective.server.research_pipeline.search'), name)
    if name == 'run':
        from contest_detective.server.research_pipeline.record import run
        return run
    raise AttributeError(f'module {__name__!r} has no attribute {name!r}')
