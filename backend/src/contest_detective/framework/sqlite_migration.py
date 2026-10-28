"""One-shot SQLite to PostgreSQL data migration with verification and rollback."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Table, create_engine, func, select, text
from sqlalchemy.engine import Connection, Engine, URL, make_url
from sqlalchemy.exc import SQLAlchemyError

from contest_detective.framework.config import DatabaseSettings
from contest_detective.framework.db import Base, create_db_engine, load_models


def head_revision() -> str:
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).parent / 'migrations'))
    heads = ScriptDirectory.from_config(config).get_heads()
    if len(heads) != 1:
        raise RuntimeError(f'expected one Alembic head, found {heads}')
    return heads[0]


def source_engine(path: Path) -> Engine:
    if not path.is_file():
        raise FileNotFoundError(f'SQLite source does not exist: {path}')
    database = 'file:' + quote(str(path.resolve()), safe='/')
    url = URL.create('sqlite', database=database, query={'mode': 'ro', 'uri': 'true'})
    return create_engine(url, connect_args={'check_same_thread': False})


def target_engine(settings: DatabaseSettings) -> Engine:
    if make_url(settings.url).get_backend_name() != 'postgresql':
        raise ValueError('target database must be PostgreSQL')
    return create_db_engine(settings=settings)


def versions(connection: Connection) -> set[str]:
    try:
        return set(connection.execute(text('SELECT version_num FROM alembic_version')).scalars())
    except SQLAlchemyError:
        return set()


def validate_target(metadata, source: Connection, target: Connection, head: str) -> None:
    source_versions = versions(source)
    target_versions = versions(target)
    if source_versions != {head}:
        found = sorted(source_versions) or ['missing']
        raise RuntimeError(f'source is at {found}, expected {head}; run alembic upgrade head on a copy first')
    if target_versions != {head}:
        found = sorted(target_versions) or ['missing']
        raise RuntimeError(f'target is at {found}, expected {head}; run alembic upgrade head first')
    occupied = []
    for table in metadata.sorted_tables:
        try:
            count = target.execute(select(func.count()).select_from(table)).scalar_one()
        except SQLAlchemyError as exc:
            raise RuntimeError(f'target schema is missing table {table.name}') from exc
        if count:
            occupied.append(f'{table.name}={count}')
    if occupied:
        raise RuntimeError('target is not empty: ' + ', '.join(occupied))


def canonical(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat(timespec='microseconds')
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value.normalize(), 'f')
    if isinstance(value, float):
        return format(Decimal(str(value)).normalize(), 'f')
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    if isinstance(value, bytes):
        return value.hex()
    return value


def table_digest(connection: Connection, table: Table) -> tuple[int, str]:
    rows = [
        tuple(canonical(value) for value in row)
        for row in connection.execute(select(*table.columns))
    ]
    rows.sort(key=repr)
    payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), default=str)
    return len(rows), sha256(payload.encode('utf-8')).hexdigest()


def copy_table(source: Connection, target: Connection, table: Table, batch_size: int = 500) -> None:
    columns = list(table.columns)
    names = [column.name for column in columns]
    batch: list[dict] = []
    for row in source.execute(select(*columns)):
        values = tuple(
            value.replace(tzinfo=timezone.utc)
            if isinstance(value, datetime) and value.tzinfo is None else value
            for value in row
        )
        batch.append(dict(zip(names, values)))
        if len(batch) >= batch_size:
            target.execute(table.insert(), batch)
            batch.clear()
    if batch:
        target.execute(table.insert(), batch)


def reset_sequence(connection: Connection, table: Table) -> dict | None:
    column = table._autoincrement_column
    if column is None:
        return None
    sequence = connection.execute(
        text('SELECT pg_get_serial_sequence(:table, :column)'),
        {'table': table.name, 'column': column.name},
    ).scalar_one_or_none()
    if not sequence:
        return None
    maximum = connection.execute(select(func.max(column))).scalar_one_or_none()
    if maximum is None:
        connection.execute(
            text('SELECT setval(CAST(:sequence AS regclass), 1, false)'),
            {'sequence': sequence},
        )
        return {'sequence': sequence, 'next': 1}
    connection.execute(
        text('SELECT setval(CAST(:sequence AS regclass), :value, true)'),
        {'sequence': sequence, 'value': maximum},
    )
    return {'sequence': sequence, 'last': maximum}


def copy_database(
    source: Path,
    target: DatabaseSettings,
    *,
    apply: bool = False,
    on_table_copied: Callable[[str], None] | None = None,
) -> dict:
    """Validate, optionally copy, and verify. A failure rolls the target transaction back."""
    load_models()
    metadata = Base.metadata
    head = head_revision()
    source_connection_engine = None
    target_connection_engine = None
    report = {
        'head': head,
        'source': str(source.resolve()),
        'target': make_url(target.url).render_as_string(hide_password=True),
        'applied': apply,
        'tables': {},
        'sequences': {},
    }
    try:
        target_connection_engine = target_engine(target)
        source_connection_engine = source_engine(source)
        with source_connection_engine.connect() as source_connection, \
                target_connection_engine.connect() as target_connection:
            validate_target(metadata, source_connection, target_connection, head)
            target_connection.rollback()
            if not apply:
                for table in metadata.sorted_tables:
                    count = source_connection.execute(
                        select(func.count()).select_from(table)
                    ).scalar_one()
                    report['tables'][table.name] = {'rows': count}
                return report
            with target_connection.begin():
                for table in metadata.sorted_tables:
                    copy_table(source_connection, target_connection, table)
                    if on_table_copied is not None:
                        on_table_copied(table.name)
                for table in metadata.sorted_tables:
                    source_count, source_hash = table_digest(source_connection, table)
                    target_count, target_hash = table_digest(target_connection, table)
                    if (source_count, source_hash) != (target_count, target_hash):
                        raise RuntimeError(f'verification failed for table {table.name}')
                    report['tables'][table.name] = {'rows': target_count, 'hash': target_hash}
                for table in metadata.sorted_tables:
                    sequence = reset_sequence(target_connection, table)
                    if sequence is not None:
                        report['sequences'][table.name] = sequence
            return report
    finally:
        if source_connection_engine is not None:
            source_connection_engine.dispose()
        if target_connection_engine is not None:
            target_connection_engine.dispose()
