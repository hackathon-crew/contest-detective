from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class ProfileSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DETECTIVE_', env_file=('../.env', '.env'),
        env_file_encoding='utf-8', extra='ignore')
    github_token: SecretStr | None = None


@lru_cache
def get_profile_settings() -> ProfileSettings:
    return ProfileSettings()
