from dataclasses import dataclass
import uuid
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from contest_detective.common.exceptions import BizException
from contest_detective.framework.config.search import get_search_settings
from contest_detective.server.agent.config import get_llm_settings
from .models import AccountSettings
from .schemas import ProviderInput, SearchPreferences
from .store import settings_for

SECRET_FIELDS = (
    "llm_api_key",
    "yuanbao_secret_id",
    "yuanbao_secret_key",
    "tavily_api_key",
)
GROUPS = {
    "llm": ("llm_api_key",),
    "yuanbao": ("yuanbao_secret_id", "yuanbao_secret_key"),
    "tavily": ("tavily_api_key",),
}


class SecuritySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DETECTIVE_ACCOUNT_", env_file=("../.env", ".env"), extra="ignore"
    )
    encryption_key: SecretStr = SecretStr("")


def cipher():
    try:
        return Fernet(SecuritySettings().encryption_key.get_secret_value())
    except (ValueError, TypeError):
        raise BizException("个人密钥加密服务还没有配置", code=503) from None


def validate_base(value):
    url = urlsplit(value)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
    ):
        raise BizException("接口地址需要完整的 HTTPS 地址", code=400)
    return value.rstrip("/")


def read_providers(row):
    values = ProviderInput().model_dump(exclude=set(SECRET_FIELDS))
    values.update(
        {k: v for k, v in (row.providers or {}).items() if not k.startswith("_")}
    )
    values["secrets"] = {
        key: {"last_four": value["last_four"]}
        for key, value in (row.providers or {}).get("_secrets", {}).items()
    }
    return values


def save_providers(session, user_id, body):
    row = settings_for(session, user_id)
    values = dict(row.providers or {})
    saved = dict(values.get("_secrets", {}))
    for key, value in body.model_dump(exclude_unset=True).items():
        if key in SECRET_FIELDS:
            if value is not None:
                saved[key] = {
                    "ciphertext": cipher().encrypt(value.encode()).decode(),
                    "last_four": value[-4:],
                }
        else:
            values[key] = validate_base(value) if key == "llm_base_url" else value
    if bool(saved.get("yuanbao_secret_id")) != bool(saved.get("yuanbao_secret_key")):
        raise BizException("元宝需要同时填写 SecretId 和 SecretKey", code=400)
    row.providers = {**values, "_secrets": saved}
    session.commit()
    return read_providers(row)


def decrypt(row, key):
    saved = (row.providers or {}).get("_secrets", {}).get(key)
    if saved is None:
        return None
    try:
        return cipher().decrypt(saved["ciphertext"]).decode()
    except (InvalidToken, KeyError, UnicodeError):
        raise BizException("个人密钥无法解密，请重新保存", code=503) from None


@dataclass
class QueryRuntime:
    llm: object
    search: object
    preferences: SearchPreferences


def runtime_for(session, user_id):
    try:
        key = uuid.UUID(user_id) if user_id else None
    except ValueError:
        key = None
    row = session.get(AccountSettings, key) if key else None
    search = get_search_settings().model_copy(deep=True)
    llm = None
    preferences = (
        SearchPreferences.model_validate(row.search or {})
        if row
        else SearchPreferences()
    )
    if row:
        key = decrypt(row, "llm_api_key")
        if key:
            values = read_providers(row)
            llm = get_llm_settings().model_copy(
                update={
                    "enabled": True,
                    "api_key": SecretStr(key),
                    "base_url": values["llm_base_url"],
                    "model": values["llm_model"],
                    "deepseek_options": values["llm_vendor"] == "deepseek",
                    "limits_mode": "external",
                }
            )
        first, second = (
            decrypt(row, "yuanbao_secret_id"),
            decrypt(row, "yuanbao_secret_key"),
        )
        if first and second:
            search = search.model_copy(
                update={
                    "yuanbao_secret_id": SecretStr(first),
                    "yuanbao_secret_key": SecretStr(second),
                }
            )
        tavily = decrypt(row, "tavily_api_key")
        if tavily:
            search = search.model_copy(update={"tavily_api_key": SecretStr(tavily)})
    if preferences.scope == "cn":
        search = search.model_copy(update={"tavily_api_key": None})
    if preferences.scope == "intl":
        search = search.model_copy(
            update={"yuanbao_secret_id": None, "yuanbao_secret_key": None}
        )
    return QueryRuntime(llm, search, preferences)
