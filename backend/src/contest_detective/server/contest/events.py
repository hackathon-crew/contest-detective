"""Serialized public facts captured when a contest event is written.

Writers must materialize separate JSON copies before and after the mutation,
within the same transaction. Readers never reconstruct snapshots from live data."""
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
