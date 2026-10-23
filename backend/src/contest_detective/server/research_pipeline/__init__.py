from contest_detective.framework.config.search import get_search_settings
from contest_detective.server.research_pipeline.service import SyncReport, run_sync
from contest_detective.server.research_pipeline.pages import fetch_page
from contest_detective.server.research_pipeline.record import run
from contest_detective.server.research_pipeline.search import SearchHit, MixedSearch, YuanbaoSearch, TavilySearch


def web_search_available() -> bool:
    config = get_search_settings()
    return any(key and key.get_secret_value() for key in (config.yuanbao_api_key, config.tavily_api_key))


def search_web(query: str, site: str | None = None, count: int = 10) -> list[SearchHit]:
    config = get_search_settings()
    providers = [provider(api_key=key.get_secret_value()) for key, provider in (
        (config.yuanbao_api_key, YuanbaoSearch), (config.tavily_api_key, TavilySearch),
    ) if key and key.get_secret_value()]
    if not providers:
        return []
    return MixedSearch(providers[0], providers[1:]).search(query, site=site, count=count)


__all__ = ['SearchHit', 'SyncReport', 'fetch_page', 'run', 'run_sync', 'search_web', 'web_search_available']
