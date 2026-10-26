from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import MetaData, create_engine, event, inspect, select, text


PARENT = '0010_account_center'
CONTENT = '0011_contest_content'
NOTIFICATIONS = '0011_notification_events'
MERGE = '0012_merge_content_notifications'
MAIL = '0012_mail_delivery'
ACCOUNT_MERGE = '0013_merge_account_mail'
WATCH = '0014_private_watch'
HEAD = '0015_registration_codes'
NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)
USER_ID = '00000000000000000000000000000001'


def config():
    result = Config()
    result.set_main_option('script_location', str(
        Path(__file__).parents[1] / 'src/contest_detective/framework/migrations'))
    return result


def migrate(engine, revision, *, downgrade=False):
    options = config()
    with engine.begin() as connection:
        options.attributes['connection'] = connection
        (command.downgrade if downgrade else command.upgrade)(options, revision)


@pytest.fixture
def migration_engine(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "migration.db"}')

    @event.listens_for(engine, 'connect')
    def enable_foreign_keys(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')

    yield engine
    engine.dispose()


def seed_legacy(engine):
    metadata = MetaData()
    metadata.reflect(engine)
    with engine.begin() as connection:
        def insert(table_name, **values):
            connection.execute(metadata.tables[table_name].insert().values(**values))

        insert('contests', id='contest', name='Synthetic event', normalized_name='syntheticevent',
               summary='Keep the complete historical description.', fields={})
        insert('contest_details', contest_id='contest',
               summary='Keep the complete historical description.', fields={})
        insert('contest_pages', id='page', url='https://organizer.example/event',
               site='Organizer', title='Synthetic event', is_official=True, content_hash='a' * 64)
        insert('contest_page_links', contest_id='contest', page_id='page')
        insert('contest_claims', contest_id='contest', page_id='page', field='team_size',
               value='1 to 4', excerpt='Solo or teams of up to four.', precision='datetime')
        insert('users', id=USER_ID, email='migration@example.test', created_at=NOW,
               profile={'skills': ['Python']}, hashed_password='synthetic-test-placeholder',
               is_active=True, is_superuser=False, is_verified=True)
        insert('sessions', user_id=USER_ID, token='synthetic-test-session', created_at=NOW)
        insert('account_settings', user_id=USER_ID, push={'enabled': False}, search={}, providers={})
        insert('account_follows', user_id=USER_ID, contest_id='contest', reminders=True,
               created_at=NOW, last_fingerprint='b' * 64)
        insert('account_tracks', id='track', user_id=USER_ID, text='Python events',
               conditions={'skills': ['Python']}, enabled=True, created_at=NOW,
               seen_contests={'contest': 'b' * 64})
        insert('account_mail', id='mail', user_id=USER_ID, message_key='synthetic-message',
               kind='digest', subject='Synthetic event', html='<p>Test</p>', text='Test',
               sender='sender@example.test', recipient='migration@example.test',
               status='sent', created_at=NOW, sent_at=NOW)


def seed_branches(engine):
    metadata = MetaData()
    metadata.reflect(engine)
    with engine.begin() as connection:
        def insert(table_name, **values):
            connection.execute(metadata.tables[table_name].insert().values(**values))

        if 'content_refresh_runs' in metadata.tables:
            details = metadata.tables['contest_details']
            connection.execute(details.update().values(
                introduction={'text': 'A synthetic event introduction.'},
                documents=[{'body': 'Retain the complete captured evidence.'}],
                coverage={'introduction': {'state': 'found'}},
                themes=['AI'], theme_sources=[{'url': 'https://organizer.example/event'}]))
            connection.execute(metadata.tables['contest_pages'].update().values(extractor_version='content-v1'))
            insert('contest_claims', contest_id='contest', page_id='page', field='team_size',
                   value='2 to 4', excerpt='Teams must have at least two.', precision='datetime')
            insert('content_refresh_runs', manifest_id='synthetic-manifest', manifest_hash='c' * 64)
            insert('content_refresh_entries', manifest_id='synthetic-manifest', entry_key='contest',
                   entry_hash='d' * 64, contest_id='contest', after_fingerprint='e' * 64)
        if 'contest_events' in metadata.tables:
            insert('contest_events', id=7, contest_id='contest', kind='updated', version='f' * 64,
                   occurred_at=NOW)
            insert('notification_pending', user_id=USER_ID, contest_id='contest', event_id=7,
                   version='f' * 64, reason='track', track_ids=['track'], queued_at=NOW)
            insert('notification_seen', user_id=USER_ID, contest_id='contest', version='b' * 64,
                   sent_at=NOW)
            insert('notification_cursors', name='synthetic-consumer', event_id=7)


def rows(engine, columns=None):
    metadata = MetaData()
    metadata.reflect(engine)
    with engine.connect() as connection:
        result = {}
        for name in metadata.tables if columns is None else columns:
            if name == 'alembic_version':
                continue
            table = metadata.tables[name]
            names = columns[name][0] if columns is not None else list(table.columns.keys())
            values = connection.execute(select(*(table.c[key] for key in names))).all()
            result[name] = (names, sorted((tuple(row) for row in values), key=repr))
        return result


def schema(engine):
    with engine.connect() as connection:
        return connection.execute(text(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        )).all()


def versions(engine):
    with engine.connect() as connection:
        return set(connection.execute(text('SELECT version_num FROM alembic_version')).scalars())


def assert_integrity(engine):
    with engine.connect() as connection:
        assert connection.exec_driver_sql('PRAGMA foreign_keys').scalar_one() == 1
        assert connection.exec_driver_sql('PRAGMA foreign_key_check').all() == []
        assert connection.exec_driver_sql('PRAGMA integrity_check').scalar_one() == 'ok'


def test_migration_graph_has_one_head_without_rewriting_published_parents():
    scripts = ScriptDirectory.from_config(config())
    assert scripts.get_heads() == [HEAD]
    assert scripts.get_revision(HEAD).down_revision == WATCH
    assert scripts.get_revision(WATCH).down_revision == ACCOUNT_MERGE
    assert scripts.get_revision(ACCOUNT_MERGE).down_revision == (MERGE, MAIL)
    assert scripts.get_revision(MERGE).down_revision == (CONTENT, NOTIFICATIONS)
    assert scripts.get_revision(CONTENT).down_revision == PARENT
    assert scripts.get_revision(NOTIFICATIONS).down_revision == PARENT


@pytest.mark.parametrize('starting_revisions', [
    (), (PARENT,), (CONTENT,), (NOTIFICATIONS,),
    (CONTENT, NOTIFICATIONS), (NOTIFICATIONS, CONTENT), (MAIL,), (MAIL, MERGE), (MERGE, MAIL),
])
def test_upgrade_head_preserves_each_preexisting_branch(migration_engine, starting_revisions):
    engine = migration_engine
    if starting_revisions:
        migrate(engine, PARENT)
        seed_legacy(engine)
        for revision in starting_revisions:
            migrate(engine, revision)
        seed_branches(engine)
    before = rows(engine)
    migrate(engine, 'head')
    assert versions(engine) == {HEAD}
    assert rows(engine, before) == before
    tables = set(inspect(engine).get_table_names())
    assert {'content_refresh_runs', 'content_refresh_entries', 'contest_events',
            'notification_pending', 'notification_seen', 'notification_cursors',
            'watch_subscriptions', 'watch_cursors', 'watch_notifications', 'watch_checks'} <= tables
    assert inspect(engine).get_pk_constraint('contest_claims')['constrained_columns'] == [
        'contest_id', 'page_id', 'field', 'value']
    assert {'introduction', 'documents', 'coverage', 'themes', 'theme_sources'} <= {
        column['name'] for column in inspect(engine).get_columns('contest_details')}
    assert 'extractor_version' in {column['name'] for column in inspect(engine).get_columns('contest_pages')}
    after, after_schema = rows(engine), schema(engine)
    migrate(engine, 'head')
    assert rows(engine) == after and schema(engine) == after_schema
    assert_integrity(engine)


@pytest.mark.parametrize('parent', [CONTENT, NOTIFICATIONS])
def test_merge_only_downgrade_retains_both_branches_and_all_data(migration_engine, parent):
    engine = migration_engine
    migrate(engine, PARENT)
    seed_legacy(engine)
    migrate(engine, CONTENT)
    migrate(engine, NOTIFICATIONS)
    seed_branches(engine)
    assert versions(engine) == {CONTENT, NOTIFICATIONS}
    before, before_schema = rows(engine), schema(engine)
    migrate(engine, MERGE)
    assert versions(engine) == {MERGE}
    assert rows(engine) == before and schema(engine) == before_schema
    # A relative '-1' is ambiguous at a merge. An explicit parent removes only
    # the merge marker; it must not execute either parent's destructive downgrade.
    migrate(engine, parent, downgrade=True)
    assert versions(engine) == {CONTENT, NOTIFICATIONS}
    assert rows(engine) == before and schema(engine) == before_schema
    migrate(engine, MERGE)
    assert versions(engine) == {MERGE}
    assert rows(engine) == before and schema(engine) == before_schema
    assert_integrity(engine)
