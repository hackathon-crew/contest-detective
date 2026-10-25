"""Observed page checks; independent of account and notification domains."""
from typing import Literal

from pydantic import AwareDatetime, BaseModel


class PageCheck(BaseModel):
    contest_id: str
    checked_at: AwareDatetime
    outcome: Literal['changed', 'unchanged', 'failed', 'no_source']
    source_url: str | None = None
    error_type: str | None = None
