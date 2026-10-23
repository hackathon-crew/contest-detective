"""SQLite 配置。

只保存文件地址，import 本模块或读取配置时都不创建、不连接数据库。
字段前缀 ``DETECTIVE_DB_``。
"""

from functools import lru_cache

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


@lru_cache
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()
