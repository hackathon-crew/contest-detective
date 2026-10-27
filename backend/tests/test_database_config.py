import pytest
from pydantic import ValidationError

from contest_detective.framework.async_db import async_database_url
from contest_detective.framework.config.database import DatabaseSettings
from contest_detective.framework.db import create_db_engine


def test_sqlite_url_is_preserved():
    settings = DatabaseSettings(url='sqlite:///./local.db')
    assert settings.url == 'sqlite:///./local.db'


def test_postgresql_url_selects_psycopg_driver():
    settings = DatabaseSettings(url='postgresql://user:pass@localhost:5432/app')
    assert settings.url == 'postgresql+psycopg://user:pass@localhost:5432/app'


def test_unsupported_driver_is_rejected():
    with pytest.raises(ValidationError):
        DatabaseSettings(url='mysql://user:pass@localhost/app')


def test_engine_factory_uses_dialect_specific_settings():
    sqlite = create_db_engine('sqlite://', settings=DatabaseSettings(url='sqlite://'))
    try:
        assert sqlite.dialect.name == 'sqlite'
    finally:
        sqlite.dispose()
    postgres = create_db_engine(
        'postgresql://user:pass@localhost:5432/app',
        settings=DatabaseSettings(url='postgresql://user:pass@localhost:5432/app'),
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
