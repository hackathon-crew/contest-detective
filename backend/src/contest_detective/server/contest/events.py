"""Immutable public facts captured when a contest event is written."""
from pydantic import BaseModel, ConfigDict, Field

from .schemas import ContestField, FieldValue


class ContestSnapshot(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str
    fields: dict[ContestField, FieldValue] = Field(default_factory=dict)


class ContestChange(BaseModel):
    # Legacy events remain missing, rather than reconstructing old facts today.
    before: ContestSnapshot | None = None
    after: ContestSnapshot | None = None
