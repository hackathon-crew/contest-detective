from fastapi import APIRouter, Depends, Query, Request, Response as HttpResponse
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import Response
from contest_detective.framework.db import get_session
from contest_detective.system.account import lifecycle
from contest_detective.system.account.schemas import Timestamp
from contest_detective.system.account.store import owner
from contest_detective.system.auth import campaign, invites
from contest_detective.system.auth.campaign_contracts import CampaignReport
from contest_detective.system.auth.service import current
from contest_detective.system.notifications.config import get_account_runtime_settings
from ..handler import SensitiveRoute
from .mail import get_mailer


class AccountRead(BaseModel):
    email: str
    email_verified: bool
    can_manage_invites: bool
    follows_count: int
    created_at: Timestamp
    password_changed_at: Timestamp | None


class InviteCreated(BaseModel):
    code: str


class EmailInput(BaseModel):
    email: EmailStr


class PasswordInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class DeleteInput(BaseModel):
    email: str = Field(max_length=320)


router = APIRouter(route_class=SensitiveRoute)


@router.get("/account/settings", response_model=Response[AccountRead])
def read_account(
    user_id: str | None = Depends(current), session: Session = Depends(get_session)
):
    return Response.success(AccountRead(**lifecycle.read_account(session, user_id)))


@router.get("/account/campaign-conversion", response_model=Response[CampaignReport])
def campaign_conversion(
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    if not invites.can_manage(owner(session, user_id)):
        raise BizException("只有管理员可以查看宣发转化。", code=403)
    response.headers["Cache-Control"] = "no-store"
    return Response.success(campaign.report(session))


@router.post("/account/invites", response_model=Response[InviteCreated])
def issue_invite(
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    if not invites.can_manage(owner(session, user_id)):
        raise BizException("只有管理员可以生成邀请码。", code=403)
    response.headers["Cache-Control"] = "no-store"
    return Response.success(InviteCreated(code=invites.issue(session)))


@router.post("/account/email", response_model=Response[None])
def request_email(
    body: EmailInput,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
    mailer=Depends(get_mailer),
):
    lifecycle.request_email(session, user_id, str(body.email), mailer)
    return Response.success()


@router.post("/account/email/verification", response_model=Response[None])
def request_verification(
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
    mailer=Depends(get_mailer),
):
    lifecycle.request_verification(session, user_id, mailer)
    return Response.success()


def _verified_redirect(flag: str) -> RedirectResponse:
    return RedirectResponse(
        get_account_runtime_settings().public_base_url.rstrip("/")
        + "/account/settings?email_verified="
        + flag,
        status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


@router.get("/account/email/verify")
def verify_email(
    token: str = Query(),
    session: Session = Depends(get_session),
):
    try:
        lifecycle.verify_email(session, token)
    except BizException:
        return _verified_redirect("0")
    return _verified_redirect("1")


@router.post("/account/password", response_model=Response[None])
def change_password(
    body: PasswordInput,
    request: Request,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    lifecycle.change_password(
        session,
        user_id,
        body.current_password,
        body.new_password,
        request.cookies.get("cd_session", ""),
    )
    return Response.success()


@router.get("/account/export", response_model=Response[dict])
def export_account(
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    response.headers["Cache-Control"] = "no-store"
    return Response.success(lifecycle.export_account(session, user_id))


@router.delete("/account", response_model=Response[None])
def delete_account(
    body: DeleteInput,
    response: HttpResponse,
    user_id: str | None = Depends(current),
    session: Session = Depends(get_session),
):
    lifecycle.delete_account(session, user_id, body.email)
    response.delete_cookie("cd_session", path="/")
    return Response.success()
