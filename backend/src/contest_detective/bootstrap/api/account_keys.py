import time
import secrets
from collections import OrderedDict
from threading import RLock
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Response as HttpResponse
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel
from sqlalchemy.orm import Session

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.framework.db import get_session
from contest_detective.framework.config.app import get_app_settings
from contest_detective.system.auth.service import current
from contest_detective.system.account import providers, tokens
from contest_detective.system.account.models import PersonalToken
from contest_detective.system.account.schemas import (
    ProviderInput,
    SearchPreferences,
    TokenMetadata,
    TokenCreated,
)
from contest_detective.system.account.store import owner, settings_for


class CredentialRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handle(request):
            try:
                return await original(request)
            except RequestValidationError:
                raise BizException("密钥或模型选项格式不正确", code=400) from None

        return handle


router = APIRouter(route_class=CredentialRoute)


class SecretMetadata(BaseModel):
    last_four: str


class ProvidersRead(BaseModel):
    llm_vendor: str
    llm_base_url: str
    llm_model: str
    secrets: dict[str, SecretMetadata]


@router.get("/account/providers", response_model=Response[ProvidersRead])
def read_providers(
    user_id: str | None = Depends(current), session: Session = Depends(get_session)
):
    return Response.success(
        providers.read_providers(settings_for(session, owner(session, user_id).id))
    )


@router.put("/account/providers", response_model=Response[ProvidersRead])
def save_providers(
    body: ProviderInput,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    return Response.success(
        providers.save_providers(session, owner(session, user_id).id, body)
    )


class ProviderUndo(BaseModel):
    undo_token: str


_removed = OrderedDict()
_lock = RLock()


@router.delete("/account/providers/{provider}", response_model=Response[ProviderUndo])
def remove_provider(
    provider: Literal["llm", "yuanbao", "tavily"],
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    user = owner(session, user_id)
    row = settings_for(session, user.id)
    values = dict(row.providers or {})
    saved = dict(values.get("_secrets", {}))
    old = {key: saved.pop(key) for key in providers.GROUPS[provider] if key in saved}
    row.providers = {**values, "_secrets": saved}
    session.commit()
    receipt = secrets.token_urlsafe(24)
    with _lock:
        while _removed and (
            len(_removed) >= 256 or next(iter(_removed.values()))[0] < time.monotonic()
        ):
            _removed.popitem(last=False)
        _removed[receipt] = (time.monotonic() + 30, user.id, old)
    return Response.success(ProviderUndo(undo_token=receipt))


@router.post("/account/providers/restore", response_model=Response[ProvidersRead])
def restore_provider(
    body: ProviderUndo,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    user = owner(session, user_id)
    with _lock:
        saved = _removed.get(body.undo_token)
        if saved is None or saved[0] < time.monotonic() or saved[1] != user.id:
            raise BizException("撤销已过期，请重新填写密钥", code=404)
        row = settings_for(session, user.id)
        values = dict(row.providers or {})
        current_secrets = dict(values.get("_secrets", {}))
        if set(current_secrets) & set(saved[2]):
            raise BizException("已保存新的密钥，无法撤销这次移除", code=409)
        row.providers = {**values, "_secrets": {**current_secrets, **saved[2]}}
        session.commit()
        del _removed[body.undo_token]
    return Response.success(providers.read_providers(row))


class ConnectionRead(BaseModel):
    message: str


@router.post("/account/providers/test", response_model=Response[ConnectionRead])
async def test_provider(
    body: ProviderInput,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    owner(session, user_id)
    if not body.llm_api_key:
        raise BizException("请先填写模型 API Key", code=400)
    base = providers.validate_base(body.llm_base_url)
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get(
                base + "/models",
                headers={"Authorization": "Bearer " + body.llm_api_key},
            )
            response.raise_for_status()
            ids = {item["id"] for item in response.json().get("data", [])}
        message = (
            "连接正常，" + body.llm_model + " 可用"
            if body.llm_model in ids
            else "连接正常，模型列表里没有 " + body.llm_model
        )
        return Response.success(ConnectionRead(message=message))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise BizException("连接失败，请检查接口地址和密钥", code=400) from None


@router.get("/account/token", response_model=Response[TokenMetadata | None])
def read_token(
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    response.headers["Cache-Control"] = "no-store"
    return Response.success(
        tokens.metadata(session.get(PersonalToken, owner(session, user_id).id))
    )


@router.post("/account/token/regenerate", response_model=Response[TokenCreated])
def regenerate_token(
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    response.headers["Cache-Control"] = "no-store"
    return Response.success(tokens.regenerate(session, owner(session, user_id).id))


@router.get("/account/search", response_model=Response[SearchPreferences])
def read_search(
    user_id: str | None = Depends(current), session: Session = Depends(get_session)
):
    return Response.success(
        SearchPreferences.model_validate(
            settings_for(session, owner(session, user_id).id).search or {}
        )
    )


@router.put("/account/search", response_model=Response[SearchPreferences])
def save_search(
    body: SearchPreferences,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    row = settings_for(session, owner(session, user_id).id)
    row.search = body.model_dump(mode="json")
    session.commit()
    return Response.success(body)


class QuotaRead(BaseModel):
    unlimited: bool


@router.get("/account/quota", response_model=Response[QuotaRead])
def read_quota(
    user_id: str | None = Depends(current), session: Session = Depends(get_session)
):
    owner(session, user_id)
    return Response.success(
        QuotaRead(unlimited=not get_app_settings().query_limits_enabled)
    )
