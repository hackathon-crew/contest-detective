"""进程级应用配置。

密钥不进仓库。字段前缀 ``DETECTIVE_``。
"""

import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTIVE_",
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = "INFO"
    sync_interval_minutes: int = Field(default=0, ge=0)
    # 北京时间 HH:MM。非空时每天在该窗口跑一轮，并忽略小时间隔。
    sync_daily_at: str = ""
    sync_window_minutes: int = Field(default=60, ge=1, le=1440)
    sync_collect: Literal['structured', 'unstructured', 'both'] = 'both'

    @field_validator("sync_daily_at")
    @classmethod
    def daily_clock(cls, value: str) -> str:
        if value == "":
            return value
        if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value) is None:
            raise ValueError("DETECTIVE_SYNC_DAILY_AT 须为 HH:MM")
        return value


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
