import os
import uuid

import pytest
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.orm import sessionmaker

from contest_detective.contest import service as contests
from contest_detective.contest.models import Contest
from contest_detective.contest.schemas import ContestDraft
from contest_detective.framework.db import init_db
from contest_detective.system.account.models import Follow
from contest_detective.system.notifications.watch import service
from contest_detective.system.notifications.watch.models import Cursor, Notification
from contest_detective.system.user.models import User

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')

pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


def draft(url, city):
    return ContestDraft(name='PostgreSQL watch test', page={'url': url, 'site': '主办方', 'title': '赛事', 'is_official': True},
        claims=[{'field': 'city', 'value': city, 'excerpt': f'地点：{city}'}])


def test_postgres_watch_upserts_are_idempotent():
    engine = create_engine(PG_URL, future=True)
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    url = f'https://organizer.example/{uuid.uuid4().hex}'
    cid = None
    try:
        with factory() as session:
            session.add(User(id=user_id, email=f'{user_id.hex}@example.com', hashed_password='not-used', is_active=True))
            session.commit()
            cid = contests.save(session, draft(url, '上海'))
            session.add(Follow(user_id=user_id, contest_id=cid))
            session.commit()
            # The second call hits the existing cursor row.
            service.set_enabled(session, user_id, cid, True)
            service.set_enabled(session, user_id, cid, True)
            contests.save(session, draft(url, '北京'), contest_id=cid)
        assert service.consume(factory, user_id) > 0
        with factory() as session:
            # Replaying from zero hits the existing notification row.
            session.get(Cursor, user_id).event_id = 0
            session.commit()
        service.consume(factory, user_id)
        with factory() as session:
            count = session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user_id))
            assert count == 1
    finally:
        with factory() as session:
            session.execute(delete(User).where(User.id == user_id))
            if cid is not None:
                session.execute(delete(Contest).where(Contest.id == cid))
            session.commit()
        engine.dispose()
