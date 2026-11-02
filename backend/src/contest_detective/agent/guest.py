"""访客任务和事件仅在执行期间留在内存，不写账号调查或聊天表。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from contextlib import suppress
import asyncio
import logging
from typing import TYPE_CHECKING, Protocol

from .schemas import AskRequest, TraceEvent
from contest_detective.framework.exceptions import BizException

if TYPE_CHECKING:
    from .loop import Investigator


class InvestigationJournal(Protocol):
    """每次运行绑定自己的日志，执行器不负责选择内存还是数据库。"""

    def append(self, event: TraceEvent, *, status: str, answer: str | None) -> TraceEvent: ...

    def active(self) -> bool: ...


@dataclass
class GuestRun:
    id: str
    owner_id: str
    question: str
    status: str
    events: list[TraceEvent] = field(default_factory=list)


class GuestJournal:
    def __init__(self, run: GuestRun):
        self.run = run

    def append(self, event: TraceEvent, *, status: str, answer: str | None) -> TraceEvent:
        if not self.active():
            raise asyncio.CancelledError
        self.run.events.append(event)
        if event.type in {'answer', 'error'}:
            self.run.status = status
        return event

    def active(self) -> bool:
        return self.run.status == 'running'


class GuestInvestigations:
    def __init__(self):
        self.runs: dict[str, GuestRun] = {}
        self.tasks: dict[str, asyncio.Task] = {}

    def has(self, investigation_id: str) -> bool:
        return investigation_id in self.runs

    def get(self, investigation_id: str, owner_id: str) -> GuestRun:
        run = self.runs.get(investigation_id)
        if run is None or run.owner_id != owner_id:
            raise BizException('查证记录不存在', code=404)
        return run

    def start(self, investigator: Investigator, body: AskRequest, owner_id: str) -> str:
        investigation_id = str(body.investigation_id)
        if self.has(investigation_id):
            run = self.get(investigation_id, owner_id)
            if run.question != body.question:
                raise BizException('该查证编号已经使用，请重新发起查证。', code=409)
            return investigation_id
        run = GuestRun(investigation_id, owner_id, body.question, 'running')
        self.runs[investigation_id] = run
        investigator.started = True
        task = asyncio.create_task(self._run(investigator, body, run))
        self.tasks[investigation_id] = task
        task.add_done_callback(lambda done: self.tasks.pop(investigation_id, None))
        return investigation_id

    async def _run(self, investigator: Investigator, body: AskRequest, run: GuestRun):
        try:
            async with investigator.agent:
                await investigator._execute(run.id, body.question, None, body.profile, body.history,
                    body.confirmed_claims, owner_id=run.owner_id, contest_id=body.contest_id, journal=GuestJournal(run))
        except Exception:
            logging.getLogger(__name__).exception('Guest investigation failed')
        finally:
            if run.status == 'running':
                run.events.append(TraceEvent(seq=len(run.events) + 1, type='error',
                    payload={'message': '这次查证已中断，可以重新提问。', 'action': 'retry'}))
                run.status = 'interrupted'
            # 留出短暂续读窗口，访客问答随后从服务端内存释放。
            asyncio.get_running_loop().call_later(300, self.runs.pop, run.id, None)

    async def events(self, investigation_id: str, owner_id: str, *, after: int = 0) -> AsyncIterator[TraceEvent]:
        run = self.get(investigation_id, owner_id)
        while True:
            for event in run.events[after:]:
                after = event.seq
                yield event
            if run.status != 'running':
                return
            await asyncio.sleep(0.05)

    async def cancel(self, investigation_id: str, owner_id: str) -> None:
        run = self.get(investigation_id, owner_id)
        if run.status == 'running':
            run.events.append(TraceEvent(seq=len(run.events) + 1, type='error', payload={'message': '查证已停止。'}))
            run.status = 'cancelled'
        task = self.tasks.get(investigation_id)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def shutdown(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.runs.clear()
