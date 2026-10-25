from typing import Literal, Protocol
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field

from contest_detective.server.contest.events import ContestChange
from contest_detective.server.research_pipeline.verification_contracts import PageCheck


class WatchSubscription(BaseModel):
    user_id: UUID
    contest_id: str
    enabled: bool = False
    activated_event_id: int = Field(default=0, ge=0)


class WatchCursor(BaseModel):
    user_id: UUID
    event_id: int = Field(default=0, ge=0)


class WatchStatus(BaseModel):
    contest_id: str
    enabled: bool = False
    state: Literal['paused', 'scheduler_paused', 'scheduled', 'no_source']
    last_check: PageCheck | None = None
    last_success_at: AwareDatetime | None = None
    next_check_at: AwareDatetime | None = None


class WatchNotification(BaseModel):
    # Persistence uniqueness is (user_id, event_id), not the mail fingerprint.
    user_id: UUID
    event_id: int = Field(ge=1)
    contest_id: str
    occurred_at: AwareDatetime
    change: ContestChange
    read_at: AwareDatetime | None = None


class WatchStore(Protocol):
    def subscriptions(self, user_id: UUID) -> list[WatchSubscription]: ...
    def set_enabled(self, user_id: UUID, contest_id: str, enabled: bool) -> WatchSubscription: ...
    def consume(self, user_id: UUID, *, limit: int = 500) -> int: ...
    def notifications(self, user_id: UUID) -> list[WatchNotification]: ...
    def mark_read(self, user_id: UUID, event_id: int) -> None: ...


class WatchChecks(Protocol):
    async def run_due(self, *, now: AwareDatetime, limit: int = 30) -> list[PageCheck]: ...
    def status(self, user_id: UUID, *, now: AwareDatetime) -> list[WatchStatus]: ...
