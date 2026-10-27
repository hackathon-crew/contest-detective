import os

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from contest_detective.framework.async_db import async_database_url
from contest_detective.framework.config.database import DEFAULT_SQLITE_URL, DatabaseSettings
from contest_detective.framework.db import create_db_engine


@pytest.fixture(autouse=True)
def clear_database_environment(monkeypatch):
    for name in list(os.environ):
        if name.startswith('DETECTIVE_DB_'):
            monkeypatch.delenv(name, raising=False)


def test_sqlite_url_is_preserved():
    settings = DatabaseSettings(url='sqlite:///./local.db', _env_file=None)
    assert settings.url == 'sqlite:///./local.db'


def test_postgresql_url_selects_psycopg_driver():
    settings = DatabaseSettings(url='postgresql://user:pass@localhost:5432/app', _env_file=None)
    assert settings.url == 'postgresql+psycopg://user:pass@localhost:5432/app'


def test_components_build_an_escaped_psycopg_url():
    settings = DatabaseSettings(
        url='',
        host='db.internal',
        port=5544,
        name='contest db',
        user='app user',
        password='p@ss:w/rd#1',
        _env_file=None,
    )
    parsed = make_url(settings.url)
    assert parsed.drivername == 'postgresql+psycopg'
    assert parsed.host == 'db.internal'
    assert parsed.port == 5544
    assert parsed.database == 'contest db'
    assert parsed.username == 'app user'
    assert parsed.password == 'p@ss:w/rd#1'


def test_url_and_components_are_mutually_exclusive():
    with pytest.raises(ValidationError):
        DatabaseSettings(
            url='sqlite:///./local.db', host='db.internal', name='app', user='user', _env_file=None
        )


def test_components_require_a_host():
    with pytest.raises(ValidationError):
        DatabaseSettings(url='', name='app', user='user', _env_file=None)


def test_missing_database_settings_default_to_sqlite():
    assert DatabaseSettings(url='', host=None, _env_file=None).url == DEFAULT_SQLITE_URL


def test_unsupported_driver_is_rejected():
    with pytest.raises(ValidationError):
        DatabaseSettings(url='mysql://user:pass@localhost/app', _env_file=None)


def test_engine_factory_uses_dialect_specific_settings():
    sqlite = create_db_engine('sqlite://', settings=DatabaseSettings(url='sqlite://', _env_file=None))
    try:
        assert sqlite.dialect.name == 'sqlite'
    finally:
        sqlite.dispose()
    postgres = create_db_engine(
        'postgresql://user:pass@localhost:5432/app',
        settings=DatabaseSettings(
            url='postgresql://user:pass@localhost:5432/app', _env_file=None
        ),
    )
    try:
        assert postgres.dialect.name == 'postgresql'
        assert postgres.url.drivername == 'postgresql+psycopg'
    finally:
        postgres.dispose()


def test_async_url_uses_async_drivers():
    assert async_database_url('sqlite:///./local.db') == 'sqlite+aiosqlite:///./local.db'
    assert async_database_url('postgresql://user:pass@localhost/app') == (
        'postgresql+psycopg://user:pass@localhost/app'
    )
