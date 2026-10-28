"""Offline SQLite to PostgreSQL data migration. The default is a read-only dry run."""

import argparse
import json
from pathlib import Path
import sys

from contest_detective.framework.config import DatabaseSettings
from contest_detective.framework.sqlite_migration import copy_database


def main() -> None:
    parser = argparse.ArgumentParser(
        description='Copy an Alembic-head SQLite database into an empty PostgreSQL database'
    )
    parser.add_argument('--source', type=Path, required=True, help='existing SQLite database file')
    parser.add_argument(
        '--target-url',
        help='PostgreSQL URL; omitted means use DETECTIVE_DB_* environment or dotenv settings',
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='validate and report counts only (default)')
    mode.add_argument('--apply', action='store_true', help='copy, verify, and commit')
    args = parser.parse_args()

    if not args.source.is_file():
        parser.error(f'--source must be an existing SQLite file: {args.source}')

    try:
        if args.target_url:
            settings = DatabaseSettings(
                url=args.target_url,
                host=None,
                name=None,
                user=None,
                password=None,
                _env_file=None,
            )
        else:
            settings = DatabaseSettings()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': f'invalid target settings: {exc}'}, ensure_ascii=False),
              file=sys.stderr)
        raise SystemExit(1)

    try:
        report = copy_database(args.source, settings, apply=args.apply)
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
    print(json.dumps({'ok': True, **report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
