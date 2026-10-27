from pathlib import Path

from alembic.script import ScriptDirectory
from alembic.config import Config
from sqlalchemy import inspect, text

from contest_detective.framework import db
from test_content_migration import migrate


def test_watch_migration_preserves_legacy_missing_snapshots_and_has_single_head(session_factory):
    engine = session_factory.kw['bind']
    migrate(engine, '0013_merge_account_mail', downgrade=True)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO contests (id,name,normalized_name,fields) VALUES ('old','Old','old','{}')"))
        connection.execute(text("INSERT INTO contest_events (contest_id,kind,version,occurred_at) VALUES ('old','updated','old','2026-10-24 00:00:00')"))
    migrate(engine, 'head')
    with engine.connect() as connection:
        row = connection.execute(text('SELECT before_snapshot, after_snapshot FROM contest_events')).one()
        assert tuple(row) == (None, None)
    for table in ('watch_subscriptions','watch_cursors','watch_notifications'):
        assert any(key['referred_table'] == 'users' for key in inspect(engine).get_foreign_keys(table))
    config = Config()
    config.set_main_option('script_location', str(Path(db.__file__).parent/'migrations'))
    assert ScriptDirectory.from_config(config).get_heads() == ['0016_pgvector_extension']
    migrate(engine, '0013_merge_account_mail', downgrade=True)
    assert 'watch_notifications' not in inspect(engine).get_table_names()
    migrate(engine, 'head')
