from datetime import datetime, timezone
import os
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import MetaData, Table, create_engine, event, inspect, select


PARENT = '0017_widen_question'


def migrate(engine, revision, *, downgrade=False):
    config = Config()
    config.set_main_option('script_location', str(
        Path(__file__).parents[1] / 'src/contest_detective/framework/migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        (command.downgrade if downgrade else command.upgrade)(config, revision)


@pytest.fixture(params=['sqlite', 'postgres'])
def migration_engine(request, tmp_path):
    if request.param == 'sqlite':
        engine = create_engine(f'sqlite:///{tmp_path / "retrieval.db"}')

        @event.listens_for(engine, 'connect')
        def foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')

        yield engine
        engine.dispose()
        return
    url = os.environ.get('DETECTIVE_TEST_DB_URL')
    if not url:
        pytest.skip('DETECTIVE_TEST_DB_URL is not configured')
    schema = 'retrieval_' + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    # 隔离迁移版本表，不能回退到 public 中已经升级过的测试库。
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema}'})
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


def test_migration_backfills_windows_and_hosts_without_changing_existing_facts(migration_engine):
    engine = migration_engine
    migrate(engine, PARENT)
    metadata = MetaData()
    contests = Table('contests', metadata, autoload_with=engine)
    details = Table('contest_details', metadata, autoload_with=engine)
    pages = Table('contest_pages', metadata, autoload_with=engine)
    facts = {
        'start_at': {'value': '2026-10-29T00:00:00Z', 'precision': 'day', 'level': 'official'},
        'registration_deadline': {'value': '2026-10-27T00:00:00Z', 'precision': 'day', 'level': 'official'},
        'submission_deadline': {'value': '2026-10-28T08:00:00Z', 'precision': 'datetime', 'level': 'official'},
    }
    with engine.begin() as connection:
        connection.execute(contests.insert().values(id='migration-contest', name='迁移比赛', normalized_name='migration', fields=facts))
        connection.execute(details.insert().values(contest_id='migration-contest', fields=facts))
        connection.execute(pages.insert().values(id='migration-page', url='https://Rules.Example.:8443/contest',
            site='主办方', title='规则', is_official=True))
        before = connection.execute(select(details)).mappings().one()
    migrate(engine, 'head')
    projected = Table('contest_details', MetaData(), autoload_with=engine)
    hosts = Table('contest_pages', MetaData(), autoload_with=engine)
    with engine.connect() as connection:
        after = connection.execute(select(projected)).mappings().one()
        assert {key: after[key] for key in before} == dict(before)
        assert datetime.fromtimestamp(after['registration_deadline_lower'] / 1_000_000, timezone.utc).isoformat() == '2026-10-26T16:00:00+00:00'
        assert datetime.fromtimestamp(after['registration_deadline_upper'] / 1_000_000, timezone.utc).isoformat() == '2026-10-27T16:00:00+00:00'
        assert after['submission_deadline_lower'] == after['submission_deadline_upper']
        assert after['end_at_lower'] is None and after['end_at_upper'] is None
        assert connection.scalar(select(hosts.c.host)) == 'rules.example'
    # 重跑 head 不改变派生值；退回父版本保留全部原始事实。
    migrate(engine, 'head')
    with engine.connect() as connection:
        assert dict(connection.execute(select(projected)).mappings().one()) == dict(after)
    migrate(engine, PARENT, downgrade=True)
    assert 'registration_deadline_upper' not in {column['name'] for column in inspect(engine).get_columns('contest_details')}
    with engine.connect() as connection:
        assert dict(connection.execute(select(details)).mappings().one()) == dict(before)
    migrate(engine, 'head')
