from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, text

from contest_detective.framework.config import DatabaseSettings
from contest_detective.framework.sqlite_migration import (
    canonical,
    copy_database,
    head_revision,
    source_engine,
    table_digest,
    target_engine,
)


def test_canonical_normalizes_cross_dialect_values():
    naive = datetime(2026, 10, 28, 1, 2, 3, 456789)
    assert canonical(naive) == '2026-10-28T01:02:03.456789+00:00'
    assert canonical(naive.replace(tzinfo=timezone.utc)) == '2026-10-28T01:02:03.456789+00:00'
    assert canonical(date(2026, 10, 28)) == '2026-10-28'
    assert canonical(Decimal('0.0500000000')) == '0.05'
    assert canonical(0.05) == '0.05'
    identifier = uuid4()
    assert canonical(UUID(str(identifier))) == str(identifier)
    assert canonical({'b': 1, 'a': [2]}) == '{"a":[2],"b":1}'


def test_head_revision_is_single():
    assert head_revision() == '0017_widen_question'


def test_source_engine_is_read_only(tmp_path):
    path = tmp_path / 'source.db'
    engine = create_engine(f'sqlite:///{path}')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE sample (id INTEGER PRIMARY KEY)'))
    engine.dispose()
    readonly = source_engine(path)
    try:
        with readonly.connect() as connection:
            assert connection.execute(text('SELECT count(*) FROM sample')).scalar_one() == 0
            with pytest.raises(Exception):
                connection.execute(text('INSERT INTO sample (id) VALUES (1)'))
    finally:
        readonly.dispose()


def test_target_must_be_postgresql():
    with pytest.raises(ValueError, match='PostgreSQL'):
        target_engine(DatabaseSettings(url='sqlite://', _env_file=None))


def test_table_digest_is_order_independent():
    metadata = MetaData()
    table = Table('sample', metadata, Column('id', Integer, primary_key=True),
                  Column('name', String(20)))
    engine = create_engine('sqlite://')
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(table.insert(), [{'id': 1, 'name': 'a'}, {'id': 2, 'name': 'b'}])
    with engine.connect() as connection:
        first = table_digest(connection, table)
    with engine.begin() as connection:
        connection.execute(table.delete())
        connection.execute(table.insert(), [{'id': 2, 'name': 'b'}, {'id': 1, 'name': 'a'}])
    with engine.connect() as connection:
        second = table_digest(connection, table)
    engine.dispose()
    assert first == second


def test_copy_rejects_a_sqlite_target(tmp_path):
    path = tmp_path / 'source.db'
    engine = create_engine(f'sqlite:///{path}')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE sample (id INTEGER PRIMARY KEY)'))
    engine.dispose()
    with pytest.raises(ValueError, match='PostgreSQL'):
        copy_database(path, DatabaseSettings(url=f'sqlite:///{path}', _env_file=None))
