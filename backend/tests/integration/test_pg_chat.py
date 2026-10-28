import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from contest_detective.agent.chat.contracts import SavedConversation
from contest_detective.agent.chat.service import SqlConversationStore, lock_chat_writes
from contest_detective.agent.schemas import TraceEvent
from contest_detective.framework.db import init_db
from contest_detective.framework.exceptions import BizException
from contest_detective.system.user.models import User

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')
pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


@pytest.fixture
def owners():
    engine = create_engine(PG_URL)
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    ids = [uuid.uuid4(), uuid.uuid4()]
    with factory() as session:
        for owner in ids:
            session.add(User(id=owner, email=f'{owner.hex}@example.org', hashed_password='unused'))
        session.commit()
    try:
        yield factory, ids
    finally:
        with factory() as session:
            lock_chat_writes(session)
            session.execute(delete(User).where(User.id.in_(ids)))
            session.commit()
        engine.dispose()


def test_postgres_account_chat_roundtrip_and_import_do_not_cross_owners(owners):
    factory, ids = owners
    for owner in ids:
        with factory() as session:
            SqlConversationStore(session, owner).start('same-session', 'one', str(owner))
            session.commit()
        with factory() as session:
            SqlConversationStore(session, owner).record('same-session', 'one', TraceEvent(type='answer', payload={'content': '已保存'}))
            session.commit()
    with factory() as session:
        saved = SqlConversationStore(session, ids[0]).get('same-session')
        assert saved.turns[0].question == str(ids[0])
        assert SqlConversationStore(session, ids[1]).get('same-session').turns[0].question == str(ids[1])
    changed = saved.model_dump()
    changed['turns'][0]['content'] = '不能覆盖'
    with factory() as session:
        SqlConversationStore(session, ids[0]).import_sessions([SavedConversation.model_validate(changed)])
        session.commit()
    with factory() as session:
        assert SqlConversationStore(session, ids[0]).get('same-session').turns[0].content == '已保存'


def test_postgres_duplicate_sends_start_only_one_turn(owners):
    factory, ids = owners
    barrier = Barrier(2)

    def send():
        barrier.wait()
        with factory() as session:
            try:
                SqlConversationStore(session, ids[0]).start('duplicate', 'same-turn', '找比赛')
                session.commit()
                return 200
            except BizException as exc:
                return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: send(), range(2))) == [200, 409]
    with factory() as session:
        assert len(SqlConversationStore(session, ids[0]).get('duplicate').turns) == 1
