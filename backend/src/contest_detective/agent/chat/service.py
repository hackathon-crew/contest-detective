import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, false, func, select, update

from contest_detective.framework.db import lock_for_write
from contest_detective.framework.exceptions import BizException
from contest_detective.system.user.models import User
from .contracts import SavedConversation, SavedRequest, SavedTurn
from .models import ChatConversation, ChatTurn


def now_ms():
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def lock_chat_writes(session):
    if session.get_bind().dialect.name == 'sqlite':
        # A write statement also locks an empty table and can join an existing
        # transaction, such as an account export followed by account deletion.
        session.execute(update(ChatConversation).where(false()).values(updated_at=ChatConversation.updated_at))
    else:
        lock_for_write(session, ChatConversation)


def recover_interrupted(session):
    # A new server process cannot own a stream left running by the previous process.
    for row in session.scalars(select(ChatTurn).where(ChatTurn.data['status'].as_string() == 'running')):
        row.data = {**row.data, 'status': 'stopped', 'error': '回复已中断，可以继续提问。', 'action': 'retry'}


def record_investigation(session, investigation_id, owner_id, event):
    try:
        owner = uuid.UUID(str(owner_id))
    except ValueError:
        return
    row = session.scalar(select(ChatTurn).where(ChatTurn.user_id == owner,
        ChatTurn.data['investigationId'].as_string() == investigation_id, ChatTurn.data['status'].as_string() == 'running'))
    if row is not None:
        SqlConversationStore(session, row.user_id).record(row.conversation_id, row.id, event)


class SqlConversationStore:
    """The caller owns the transaction; owner always comes from authenticated identity."""

    def __init__(self, session, user_id):
        self.session = session
        self.owner = uuid.UUID(str(user_id))

    def _conversation(self, conversation_id):
        row = self.session.get(ChatConversation, (self.owner, conversation_id))
        if row is None:
            raise BizException('对话不存在', code=404)
        return row

    def get(self, conversation_id):
        row = self._conversation(conversation_id)
        turns = self.session.scalars(select(ChatTurn).where(
            ChatTurn.user_id == self.owner, ChatTurn.conversation_id == row.id,
        ).order_by(ChatTurn.created_at, ChatTurn.id)).all()
        return SavedConversation(id=row.id, title=row.title, createdAt=row.created_at, updatedAt=row.updated_at,
                                 turns=[SavedTurn.model_validate(turn.data) for turn in turns])

    def list_sessions(self):
        conversations = self.session.scalars(select(ChatConversation).where(
            ChatConversation.user_id == self.owner,
        ).order_by(ChatConversation.updated_at.desc(), ChatConversation.id)).all()
        turns = self.session.scalars(select(ChatTurn).where(ChatTurn.user_id == self.owner)
                                    .order_by(ChatTurn.created_at, ChatTurn.id)).all()
        grouped = {}
        for turn in turns:
            grouped.setdefault(turn.conversation_id, []).append(SavedTurn.model_validate(turn.data))
        return [SavedConversation(id=row.id, title=row.title, createdAt=row.created_at,
                                  updatedAt=row.updated_at, turns=grouped.get(row.id, [])) for row in conversations]

    def _lock(self):
        # Serialize inserts as well as updates so duplicate sends cannot start two model runs.
        lock_chat_writes(self.session)

    def _require_account(self):
        user = self.session.get(User, self.owner)
        if user is None or not user.is_active:
            raise BizException('请先登录', code=401)

    def import_sessions(self, sessions):
        self._lock()
        self._require_account()
        for saved in sessions:
            row = self.session.get(ChatConversation, (self.owner, saved.id))
            if row is None:
                row = ChatConversation(user_id=self.owner, id=saved.id, title=saved.title,
                                       created_at=saved.createdAt, updated_at=saved.updatedAt)
                self.session.add(row)
                self.session.flush()
            for index, turn in enumerate(saved.turns):
                if self.session.get(ChatTurn, (self.owner, row.id, turn.id)) is not None:
                    continue
                data = turn.model_copy(deep=True)
                if data.status == 'running':
                    data.status, data.error = 'stopped', '回复已中断，可以继续提问。'
                self.session.add(ChatTurn(user_id=self.owner, conversation_id=row.id, id=turn.id,
                    created_at=saved.createdAt + index, data=data.model_dump(mode='json', exclude_none=True)))
                self.session.flush()

    def find_investigation(self, investigation_id):
        return self.session.scalar(select(ChatTurn).where(ChatTurn.user_id == self.owner,
            ChatTurn.data['investigationId'].as_string() == investigation_id))

    def start(self, conversation_id, turn_id, question, *, investigation_id=None, retry_of=None, saved_request=None):
        self._lock()
        self._require_account()
        bound = self.find_investigation(investigation_id) if investigation_id else None
        if bound is not None and (bound.conversation_id != conversation_id or bound.id != turn_id):
            raise BizException('该查证编号已经属于另一条问题。', code=409)
        previous = self.session.get(ChatTurn, (self.owner, conversation_id, turn_id))
        if previous is not None:
            previous_ref = (previous.data.get('request') or {}).get('contest') or {}
            next_ref = SavedRequest.model_validate(saved_request or {}).contest
            next_id = next_ref.id if next_ref is not None else None
            if previous_ref.get('id') != next_id:
                raise BizException('这条问题引用的比赛已改变，请重新提问。', code=409)
            if investigation_id and previous.data.get('investigationId') == investigation_id and previous.data['question'] == question:
                return
            if not retry_of or previous.data.get('investigationId') != retry_of or previous.data['status'] == 'running' or previous.data['question'] != question:
                raise BizException('这条问题已经发送，请等待回复或重新提问。', code=409)
            previous.data = SavedTurn(id=turn_id, question=question, status='running', investigationId=investigation_id,
                request=saved_request).model_dump(mode='json', exclude_none=True)
            self._conversation(conversation_id).updated_at = now_ms()
            return
        row = self.session.get(ChatConversation, (self.owner, conversation_id))
        now = now_ms()
        if row is None:
            row = ChatConversation(user_id=self.owner, id=conversation_id, title=' '.join(question.split())[:32],
                                   created_at=now, updated_at=now)
            self.session.add(row)
            self.session.flush()
        last = self.session.scalar(select(func.max(ChatTurn.created_at)).where(
            ChatTurn.user_id == self.owner, ChatTurn.conversation_id == conversation_id))
        created_at = max(now, (last + 1) if last is not None else now)
        row.updated_at = max(row.updated_at, created_at)
        data = SavedTurn(id=turn_id, question=question, status='running', investigationId=investigation_id, request=saved_request)
        self.session.add(ChatTurn(user_id=self.owner, conversation_id=conversation_id, id=turn_id,
                                  created_at=created_at, data=data.model_dump(mode='json', exclude_none=True)))

    def record(self, conversation_id, turn_id, event):
        self._lock()
        row = self.session.get(ChatTurn, (self.owner, conversation_id, turn_id))
        # Account deletion can race with a running stream; it must never recreate erased data.
        if row is None:
            return
        turn = SavedTurn.model_validate(row.data).model_dump(mode='json', exclude_none=True)
        if turn['status'] != 'running':
            return
        if event.seq and event.seq <= turn.get('lastSeq', 0):
            return
        turn['lastSeq'] = event.seq
        data = event.payload
        if event.type in {'step', 'observation'}:
            turn['trace'].append({'type': event.type, **data})
        elif event.type == 'plan':
            turn['plan'] = data
        elif event.type == 'answer':
            turn['content'] = data['content'] or turn['content']
            turn['sources'] = data.get('sources', [])
            turn['recommendations'] = data.get('recommendations', [])
            turn['report'] = data.get('report')
            if turn['report']:
                turn['plan'] = turn['report'].get('plan')
            turn['status'] = 'stopped' if data.get('action') in {'retry', 'settings'} else 'completed'
        elif event.type == 'error':
            turn['status'], turn['error'] = ('stopped' if turn['content'].strip() else 'error'), data['message']
        if data.get('action'):
            turn['action'] = data['action']
        # Revalidate the public payload after projecting an event, before it reaches storage.
        row.data = SavedTurn.model_validate(turn).model_dump(mode='json', exclude_none=True)
        conversation = self._conversation(conversation_id)
        conversation.updated_at = max(conversation.updated_at, now_ms())

    def finish(self, conversation_id, turn_id):
        self._lock()
        row = self.session.get(ChatTurn, (self.owner, conversation_id, turn_id))
        if row is not None and row.data['status'] == 'running':
            row.data = {**row.data, 'status': 'stopped', 'error': '回复已中断，可以继续提问。'}

    def delete_all(self):
        self.session.execute(delete(ChatTurn).where(ChatTurn.user_id == self.owner))
        self.session.execute(delete(ChatConversation).where(ChatConversation.user_id == self.owner))
