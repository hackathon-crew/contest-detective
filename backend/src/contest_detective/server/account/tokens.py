from contextvars import ContextVar
from datetime import datetime, timezone
from hashlib import sha256
import secrets
import uuid

from sqlalchemy import select
from contest_detective.server.user.models import User
from .models import PersonalToken
from .schemas import TokenCreated, TokenMetadata

mcp_owner = ContextVar("mcp_owner", default=None)


def metadata(row):
    return (
        TokenMetadata.model_validate(
            {name: getattr(row, name) for name in TokenMetadata.model_fields}
        )
        if row
        else None
    )


def regenerate(session, user_id):
    raw = "ink_pt_" + secrets.token_urlsafe(32)
    row = session.get(PersonalToken, user_id)
    if row is None:
        row = PersonalToken(user_id=user_id)
        session.add(row)
    row.token_hash, row.prefix, row.last_four = (
        sha256(raw.encode()).hexdigest(),
        raw[:7],
        raw[-4:],
    )
    row.created_at, row.last_used_at = datetime.now(timezone.utc), None
    session.commit()
    return TokenCreated(token=raw, metadata=metadata(row))


def resolve_token(session, raw, *, touch=False):
    if not raw.startswith("ink_pt_") or not 30 <= len(raw) <= 100:
        return None
    row = session.scalar(
        select(PersonalToken).where(
            PersonalToken.token_hash == sha256(raw.encode()).hexdigest()
        )
    )
    if row is None:
        return None
    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    if touch:
        row.last_used_at = datetime.now(timezone.utc)
        session.commit()
    return user
