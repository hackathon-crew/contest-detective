"""Backfill or retry contest embeddings after configuring Postgres and the API key."""
import json
import logging
from dataclasses import asdict

from contest_detective.agent.rag.index import refresh_index
from contest_detective.framework.db import SessionLocal, init_db


def main():
    logging.basicConfig(level=logging.INFO)
    init_db()
    report = refresh_index(SessionLocal)
    print(json.dumps(asdict(report)))
    if report.failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
