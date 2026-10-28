import os
import uuid

import pytest
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from contest_detective.contest import service
from contest_detective.contest.models import Contest
from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.framework.db import init_db

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')

pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


def test_postgres_migration_and_contest_round_trip():
    engine = create_engine(PG_URL, future=True)
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    page_url = f'https://example.test/{uuid.uuid4().hex}'
    with factory() as session:
        contest_id = service.save(session, ContestDraft(
            name='PostgreSQL smoke test',
            page=PageIn(url=page_url, site='example', title='Smoke', is_official=True),
            claims=[ClaimIn(field='start_at', value='2026-11-01T00:00:00Z',
                            excerpt='Start 2026-11-01', precision='datetime')],
        ))
        detail = service.get(session, contest_id)
        assert detail is not None
        assert detail.fields['start_at'].value == '2026-11-01T00:00:00Z'
        session.execute(delete(Contest).where(Contest.id == contest_id))
        session.commit()
    engine.dispose()


def test_postgres_query_filters_sorts_and_pages_before_reading_evidence(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from contest_detective.contest.schemas import ContestQuery

    engine = create_engine(PG_URL, future=True)
    init_db(engine)
    ids = []
    try:
        with sessionmaker(bind=engine, expire_on_commit=False)() as session:
            for index in range(8):
                start = datetime(2026, 11, 1, tzinfo=timezone.utc) + timedelta(days=index)
                ids.append(service.save(session, ContestDraft(name=f'PG 查询 {index}', page=PageIn(
                    url=f'https://example.test/{uuid.uuid4().hex}', site='example', title='规则', is_official=True),
                    claims=[ClaimIn(field='start_at', value=start.isoformat(), excerpt='比赛日程'),
                            ClaimIn(field='registration_deadline', value='2026-10-23' if index == 0 else '2026-10-27',
                                    precision='day', excerpt='报名截止')])))
            read = []
            summary = service._summary

            def observe(*args):
                read.append(args[1].id)
                return summary(*args)

            monkeypatch.setattr(service, '_summary', observe)
            items, total = service.query(session, ContestQuery(ids=ids, sort='start', page=2, page_size=2), attendable=True)
            assert total == 7 and [item.id for item in items] == ids[3:5]
            assert read == ids[3:5]
            monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 27, 16, tzinfo=timezone.utc))
            assert service.query(session, ContestQuery(ids=ids), attendable=True) == ([], 0)
            assert service.query(session, ContestQuery(ids=ids))[1] == 8
    finally:
        with sessionmaker(bind=engine)() as session:
            session.execute(delete(Contest).where(Contest.id.in_(ids)))
            session.commit()
        engine.dispose()
