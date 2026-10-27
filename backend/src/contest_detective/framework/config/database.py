"""数据库配置。

只保存连接参数，import 本模块或读取配置时都不创建、不连接数据库。
字段前缀 ``DETECTIVE_DB_``。
"""

from functools import lru_cache
from pathlib import Path
import sys

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


def normalize_database_url(value: str) -> str:
    """Select the psycopg driver for PostgreSQL and reject unsupported backends."""
    try:
        parsed = make_url(value)
    except Exception as exc:
        raise ValueError("数据库地址无效") from exc
    backend = parsed.get_backend_name()
    if backend == "postgres":
        parsed = parsed.set(drivername="postgresql+psycopg")
        backend = "postgresql"
    elif backend == "postgresql" and parsed.drivername == "postgresql":
        parsed = parsed.set(drivername="postgresql+psycopg")
    if backend not in {"sqlite", "postgresql"}:
        raise ValueError("只支持 SQLite 或 PostgreSQL")
    return parsed.render_as_string(hide_password=False)


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTIVE_DB_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    url: str = "sqlite:///./contest_detective.db"
    pool_size: int = Field(default=5, ge=1, le=50)
    max_overflow: int = Field(default=10, ge=0, le=100)
    pool_timeout: int = Field(default=30, ge=1, le=300)
    pool_recycle: int = Field(default=1800, ge=60)
    echo: bool = False

    @field_validator("url")
    @classmethod
    def supported_url(cls, value: str) -> str:
        return normalize_database_url(value)


_offline_settings: DatabaseSettings | None = None


def configure_offline_database(path: Path) -> None:
    """Dedicated CLI bootstrap: bind one explicit SQLite path without reading dotenv files."""
    global _offline_settings
    if 'contest_detective.framework.db' in sys.modules:
        raise RuntimeError('Offline database must be selected before runtime database imports')
    _offline_settings = DatabaseSettings(_env_file=None, url='sqlite:///' + str(path.resolve()))
    get_database_settings.cache_clear()


@lru_cache
def get_database_settings() -> DatabaseSettings:
    return _offline_settings if _offline_settings is not None else DatabaseSettings()
