"""访客任务和事件仅在执行期间留在内存，不写账号调查或聊天表。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from .schemas import AskRequest, TraceEvent

if TYPE_CHECKING:
    from .loop import Investigator


class InvestigationJournal(Protocol):
    """每次运行绑定自己的日志，执行器不负责选择内存还是数据库。"""

    def append(self, event: TraceEvent, *, status: str, answer: str | None) -> TraceEvent: ...

    def active(self) -> bool: ...


@dataclass(frozen=True)
class GuestRun:
    id: str
    owner_id: str
    question: str
    status: str


class GuestInvestigations:
    def get(self, investigation_id: str, owner_id: str) -> GuestRun:
        raise NotImplementedError

    def start(self, investigator: Investigator, body: AskRequest, owner_id: str) -> str:
        raise NotImplementedError

    def events(self, investigation_id: str, owner_id: str, *, after: int = 0) -> AsyncIterator[TraceEvent]:
        raise NotImplementedError

    async def cancel(self, investigation_id: str, owner_id: str) -> None:
        raise NotImplementedError

    async def shutdown(self) -> None:
        raise NotImplementedError
