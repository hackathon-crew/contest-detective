from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class NotificationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DETECTIVE_', env_file=('../.env', '.env'), env_file_encoding='utf-8', extra='ignore')
    public_base_url: str = 'http://localhost:5173'
    mail_enabled: bool = False
    resend_api_key: SecretStr = SecretStr('')
    resend_webhook_secret: SecretStr = SecretStr('')
    mail_sender: str = ''
    # 默认是免费档硬上限；调整上限须先确认预算。
    mail_daily_limit: int = Field(default=100, ge=0)
    mail_monthly_limit: int = Field(default=3000, ge=0)


@lru_cache
def get_account_runtime_settings():
    return NotificationSettings()
