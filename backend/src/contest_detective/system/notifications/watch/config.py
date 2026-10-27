from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class WatchSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DETECTIVE_', env_file=('../.env', '.env'), extra='ignore')
    watch_enabled: bool = False
    watch_interval_minutes: int = Field(default=1440, ge=60, le=10080)
    watch_batch_size: int = Field(default=30, ge=1, le=100)


@lru_cache
def get_watch_settings():
    return WatchSettings()
