"""SQLite 配置。

只保存文件地址，import 本模块或读取配置时都不创建、不连接数据库。
字段前缀 ``DETECTIVE_DB_``。
"""

from functools import lru_cache
from pathlib import Path
import sys

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTIVE_DB_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    url: str = "sqlite:///./contest_detective.db"

    @field_validator("url")
    @classmethod
    def sqlite_only(cls, value: str) -> str:
        if not value.startswith("sqlite:"):
            raise ValueError("只支持 SQLite")
        return value


_offline_settings: DatabaseSettings | None = None


def configure_offline_database(path: Path) -> None:
    """Dedicated CLI bootstrap: bind one explicit path without reading dotenv files."""
    global _offline_settings
    if 'contest_detective.framework.db' in sys.modules:
        raise RuntimeError('Offline database must be selected before runtime database imports')
    _offline_settings = DatabaseSettings(_env_file=None, url='sqlite:///' + str(path.resolve()))
    get_database_settings.cache_clear()


@lru_cache
def get_database_settings() -> DatabaseSettings:
    return _offline_settings if _offline_settings is not None else DatabaseSettings()
