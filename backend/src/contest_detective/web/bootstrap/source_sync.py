"""在装配层选择抽取器，来源模块不依赖具体模型供应商。"""

import logging

from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.config.search import get_search_settings
from contest_detective.framework.db import SessionLocal, init_db
from contest_detective.server.agent.config import get_llm_settings
from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline


def configured_extractor(session_factory):
    if get_app_settings().sync_collect == 'structured' or not get_llm_settings().enabled:
        return None
    from contest_detective.server.agent.extraction import create_page_extractor
    return create_page_extractor(session_factory=session_factory)


def configured_normalizer():
    settings = get_llm_settings()
    key = getattr(settings, 'api_key', None)
    if not settings.enabled or not key or not key.get_secret_value():
        return None
    from contest_detective.server.agent.normalization import create_normalizer
    return create_normalizer(settings, session_factory=SessionLocal)


def configured_tavily():
    settings = get_search_settings()
    key = settings.tavily_api_key.get_secret_value() if settings.tavily_api_key else ''
    if not key:
        return None
    from contest_detective.server.research_pipeline.search.tavily import TavilySearch
    return TavilySearch(api_key=key)


def main() -> None:
    logging.basicConfig(level=get_app_settings().log_level)
    init_db()
    kwargs = {'extractor': configured_extractor(SessionLocal)}
    normalizer = configured_normalizer()
    tavily = configured_tavily()
    if normalizer is not None:
        kwargs['normalizer'] = normalizer
    if tavily is not None and normalizer is not None:
        kwargs['tavily'] = tavily
    report = run_pipeline(SessionLocal, **kwargs)
    print(report.model_dump_json())
