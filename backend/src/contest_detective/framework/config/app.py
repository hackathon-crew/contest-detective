"""进程级应用配置。

密钥不进仓库。字段前缀 ``DETECTIVE_``。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTIVE_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = "INFO"


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
