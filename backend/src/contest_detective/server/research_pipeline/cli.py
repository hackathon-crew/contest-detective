import logging

from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.db import SessionLocal, init_db
from contest_detective.server.research_pipeline.service import run_sync


def main() -> None:
    logging.basicConfig(level=get_app_settings().log_level)
    init_db()
    report = run_sync(SessionLocal)
    print(report.model_dump_json())
