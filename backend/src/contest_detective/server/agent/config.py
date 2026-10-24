"""调用开关默认关闭；本地和服务端分别配置 1.5 / 3.5 元预算。"""
from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DETECTIVE_LLM_', env_file=('../.env', '.env'), extra='ignore')

    enabled: bool = False
    limits_mode: Literal['local', 'external'] = 'local'
    deepseek_options: bool = True
    api_key: SecretStr = SecretStr('')
    base_url: str = 'https://api.deepseek.com'
    model: str = 'deepseek-flash'
    budget_cny: Decimal = Field(default=Decimal('1.5'), gt=0, le=5)
    balance_floor_cny: Decimal = Field(default=Decimal('90'), ge=0)
    max_tokens: int = Field(default=8192, ge=2000, le=32768)
    max_input_tokens: int = Field(default=65536, ge=8192, le=131072)


@lru_cache
def get_llm_settings() -> LLMSettings:
    return LLMSettings()
