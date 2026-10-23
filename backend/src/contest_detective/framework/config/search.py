from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class SearchSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix='DETECTIVE_', env_file=('../.env', '.env'),
        env_file_encoding='utf-8', extra='ignore',
    )

    yuanbao_api_key: SecretStr | None = None
    tavily_api_key: SecretStr | None = None


@lru_cache
def get_search_settings() -> SearchSettings:
    return SearchSettings()
