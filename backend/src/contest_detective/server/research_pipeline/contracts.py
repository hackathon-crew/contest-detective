"""Search execution receipts; populated by providers, never by model output."""
from datetime import datetime
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

class SearchExecution(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # These values come from the execution layer, never model output.
    id: str
    step_id: str
    round: int = Field(ge=1)
    query: str
    provider: str
    status: Literal['success', 'failure']
    executed_at: datetime
    result_count: int = Field(ge=0)
    error_code: str | None = None



class StrictSearchAvailability(Protocol):
    def available(self) -> bool: ...
