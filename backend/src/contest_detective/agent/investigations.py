"""任务持有执行资源，连接只读数据库事件；内存引用仅用于主动取消。"""
import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import func, select

from contest_detective.framework.exceptions import BizException
from .models import Investigation, TraceRecord
from .schemas import TraceEvent
from .chat.service import lock_chat_writes, record_investigation

logger = logging.getLogger(__name__)
INTERRUPTED = {'message': '这次查证已中断。点击一键重查，无需重新输入问题。', 'action': 'retry'}


class Investigations:
    def __init__(self, session_factory):
        self.session_factory = session_factory
        self.tasks: dict[tuple[str, str | None], asyncio.Task] = {}

    def get(self, investigation_id, owner_id):
        with self.session_factory() as session:
            row = session.get(Investigation, investigation_id)
            if row is None or row.user_id != owner_id:
                raise BizException('查证记录不存在', code=404)
            return row

    def start(self, investigator, body, owner_id, user_id, *, require_owner=False):
        investigation_id = str(body.investigation_id or uuid4())
        with self.session_factory() as session:
            lock_chat_writes(session)
            if require_owner:
                from .chat.service import SqlConversationStore
                SqlConversationStore(session, user_id)._require_account()
            existing = session.get(Investigation, investigation_id)
            if existing is not None:
                self.get(investigation_id, owner_id)
                if existing.question != body.question:
                    raise BizException('该查证编号已经使用，请重新发起查证。', code=409)
                return investigation_id
            session.add(Investigation(id=investigation_id, question=body.question, user_id=owner_id, status='running'))
            session.commit()
        investigator.started = True
        task = asyncio.create_task(self._run(investigator, investigation_id, body, user_id, owner_id))
        self.tasks[investigation_id, owner_id] = task
        task.add_done_callback(lambda done: self._finished(investigation_id, owner_id, done))
        return investigation_id

    async def _run(self, investigator, investigation_id, body, user_id, owner_id):
        try:
            async with investigator.agent:
                await investigator._execute(investigation_id, body.question, user_id, body.profile,
                                            body.history, body.confirmed_claims, owner_id=owner_id)
        finally:
            self._interrupt(investigation_id, owner_id)

    def _finished(self, investigation_id, owner_id, task):
        if self.tasks.get((investigation_id, owner_id)) is task:
            self.tasks.pop((investigation_id, owner_id), None)
        if not task.cancelled() and (error := task.exception()) is not None:
            logger.error('Investigation task failed: %s', investigation_id, exc_info=error)

    def _terminal(self, session, row, status, payload):
        seq = session.scalar(select(func.coalesce(func.max(TraceRecord.seq), 0))
                             .where(TraceRecord.investigation_id == row.id)) + 1
        session.add(TraceRecord(investigation_id=row.id, seq=seq, type='error', payload=payload))
        record_investigation(session, row.id, row.user_id, TraceEvent(type='error', payload=payload, seq=seq))
        row.status, row.finished_at = status, datetime.now(timezone.utc)

    def _interrupt(self, investigation_id, owner_id):
        with self.session_factory() as session:
            lock_chat_writes(session)
            row = session.get(Investigation, investigation_id)
            if row is not None and row.user_id == owner_id and row.status == 'running':
                self._terminal(session, row, 'interrupted', INTERRUPTED)
                session.commit()

    def recover_interrupted(self):
        # 部署使用单个应用进程；重启后旧的 running 记录不再有执行者。
        with self.session_factory() as session:
            lock_chat_writes(session)
            for row in session.scalars(select(Investigation).where(Investigation.status == 'running')):
                self._terminal(session, row, 'interrupted', INTERRUPTED)
            session.commit()

    async def events(self, investigation_id, owner_id, *, after=0):
        self.get(investigation_id, owner_id)
        while True:
            with self.session_factory() as session:
                rows = session.scalars(select(TraceRecord).where(
                    TraceRecord.investigation_id == investigation_id, TraceRecord.seq > after,
                ).order_by(TraceRecord.seq).limit(100)).all()
                investigation = session.get(Investigation, investigation_id)
                if investigation is None or investigation.user_id != owner_id:
                    return
                running = investigation.status == 'running'
            for row in rows:
                after = row.seq
                # payload 已在写入时校验并转成公开格式，不再次补齐已省略的可空字段。
                yield TraceEvent.model_construct(type=row.type, payload=row.payload, seq=row.seq)
            if not running and len(rows) < 100:
                return
            await asyncio.sleep(0.2)

    async def cancel(self, investigation_id, owner_id):
        self.get(investigation_id, owner_id)
        with self.session_factory() as session:
            lock_chat_writes(session)
            row = session.get(Investigation, investigation_id)
            if row is not None and row.user_id == owner_id and row.status == 'running':
                self._terminal(session, row, 'cancelled', {'message': '查证已停止。'})
                session.commit()
        if task := self.tasks.get((investigation_id, owner_id)):
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
