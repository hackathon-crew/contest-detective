import uuid

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError

from contest_detective.system.user.models import User


def test_chat_migration_keeps_client_ids_scoped_to_the_account(session):
    assert 'chat_conversations' in inspect(session.get_bind()).get_table_names()
    from contest_detective.agent.chat.models import ChatConversation, ChatTurn

    session.execute(text('PRAGMA foreign_keys=ON'))
    owners = [uuid.uuid4(), uuid.uuid4()]
    for number, owner in enumerate(owners):
        session.add(User(id=owner, email=f'person-{number}@example.com', hashed_password='unused'))
    session.commit()
    for owner in owners:
        session.add(ChatConversation(user_id=owner, id='same-session', title='我的比赛', created_at=1, updated_at=1))
    session.commit()
    for owner in owners:
        session.add(ChatTurn(user_id=owner, conversation_id='same-session', id='same-turn', created_at=1, data={'question': str(owner)}))
    session.commit()
    rows = session.scalars(select(ChatTurn).where(ChatTurn.user_id == owners[0])).all()
    assert [row.data['question'] for row in rows] == [str(owners[0])]
    session.add(ChatTurn(user_id=owners[0], conversation_id='someone-elses-session', id='other-turn', created_at=1, data={}))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
