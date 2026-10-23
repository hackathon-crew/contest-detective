from sqlalchemy import inspect, text

from contest_detective.framework.db import init_db


def test_migrations_are_idempotent_in_the_requested_engine(session):
    init_db(session.get_bind())
    init_db(session.get_bind())
    assert 'alembic_version' in inspect(session.get_bind()).get_table_names()
    assert session.execute(text('SELECT count(*) FROM alembic_version')).scalar_one() == 1


def test_health_uses_isolated_app(client):
    assert client.get('/health').json()['data'] == {'status': 'ok'}
