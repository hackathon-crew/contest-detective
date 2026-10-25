from typing import Literal, Protocol
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, model_validator

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


    @model_validator(mode='after')
    def scheduling_state(self):
        if self.last_check is not None and self.last_check.contest_id != self.contest_id:
            raise ValueError('检查记录必须属于当前赛事')
        if self.last_success_at is not None and (self.last_check is None or
                self.last_success_at > self.last_check.completed_at):
            raise ValueError('成功时间必须有对应检查记录')
        if (self.state == 'paused') != (not self.enabled):
            raise ValueError('订阅启用状态与暂停状态不一致')
        if (self.state == 'scheduled') != (self.next_check_at is not None):
            raise ValueError('只有已排期检查可以包含预计下次时间')
        return self


class WatchNotification(BaseModel):
    # Persistence uniqueness is (user_id, event_id), not the mail fingerprint.
    user_id: UUID
    event_id: int = Field(ge=1)
    contest_id: str
    occurred_at: AwareDatetime
    change: ContestChange
    read_at: AwareDatetime | None = None


class WatchStore(Protocol):
    """All operations are owner-scoped and independent of mail state.

    Enabling requires an existing follow and atomically resets that subscription's
    activation baseline to the current event position, including on resumption.
    Consumption commits the owner cursor and unique (owner, event) notifications
    together; retries/concurrent consumers cannot duplicate or lose notifications.
    Only events after activation are eligible; unfollow removes subscriptions and
    prevents further delivery. mark_read matches both owner and event or fails.
    Account export includes private watch data; account deletion removes it.
    No method reads/writes the mail cursor, queue, or Follow.last_fingerprint.
    """
    def subscriptions(self, user_id: UUID) -> list[WatchSubscription]: ...
    def set_enabled(self, user_id: UUID, contest_id: str, enabled: bool) -> WatchSubscription: ...
    def consume(self, user_id: UUID, *, limit: int = 500) -> int: ...
    def notifications(self, user_id: UUID) -> list[WatchNotification]: ...
    def mark_read(self, user_id: UUID, event_id: int) -> None: ...


class WatchChecks(Protocol):
    async def run_due(self, *, now: AwareDatetime, limit: int = 30) -> list[PageCheck]: ...
    def status(self, user_id: UUID, *, now: AwareDatetime) -> list[WatchStatus]: ...
