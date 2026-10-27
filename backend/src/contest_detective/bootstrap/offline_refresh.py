"""Explicit, keyless offline import. Does not start the application or source sync."""

import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description='Validate or apply a reviewed public contest refresh package offline')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--manifest', type=Path)
    source.add_argument('--rollback', type=Path)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--apply', action='store_true', help='Write changes; omitted means dry-run')
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error('--database must select an existing migrated local SQLite file')
    from contest_detective.framework.config.database import configure_offline_database
    configure_offline_database(args.database)
    if args.rollback:
        if not args.apply:
            parser.error('Rollback writes require --apply; no data was changed')
        from contest_detective.research.refresh.journal import restore
        restore(database=args.database, journal=args.rollback)
        print('{"rollback":"completed"}')
        return
    from contest_detective.research.refresh.contracts import RefreshManifest
    from contest_detective.research.refresh.importer import MAX_MANIFEST_BYTES, OfflineImporter
    if args.manifest.stat().st_size > MAX_MANIFEST_BYTES:
        parser.error('Manifest exceeds the 32 MiB size limit')
    manifest = RefreshManifest.model_validate_json(args.manifest.read_text())
    report = OfflineImporter().run(manifest, database=args.database, dry_run=not args.apply,
                                   output_directory=args.output_directory)
    print(report.model_dump_json())
    if report.failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
