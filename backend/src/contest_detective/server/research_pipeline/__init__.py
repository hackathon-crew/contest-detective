from contest_detective.framework.config.search import get_search_settings
from contest_detective.server.research_pipeline.pages import fetch_page
from contest_detective.server.research_pipeline.search import SearchHit, MixedSearch, YuanbaoSearch


def web_search_available() -> bool:
    key = get_search_settings().yuanbao_api_key
    return bool(key and key.get_secret_value())


def search_web(query: str, site: str | None = None, count: int = 10) -> list[SearchHit]:
    settings = get_search_settings()
    if not settings.yuanbao_api_key or not settings.yuanbao_api_key.get_secret_value():
        return []
    return MixedSearch(YuanbaoSearch(api_key=settings.yuanbao_api_key.get_secret_value())).search(
        query, site=site, count=count,
    )


__all__ = ['SearchHit', 'fetch_page', 'search_web', 'web_search_available']
