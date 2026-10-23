"""在装配层选择抽取器，来源模块不依赖具体模型供应商。"""

import logging

from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.db import SessionLocal, init_db
from contest_detective.server.agent.config import get_llm_settings
from contest_detective.server.research_pipeline.service import run_sync


def configured_extractor(session_factory):
    if not get_llm_settings().enabled:
        return None
    from contest_detective.server.agent.extraction import create_page_extractor
    return create_page_extractor(session_factory=session_factory)


def main() -> None:
    logging.basicConfig(level=get_app_settings().log_level)
    init_db()
    report = run_sync(SessionLocal, extractor=configured_extractor(SessionLocal))
    print(report.model_dump_json())
