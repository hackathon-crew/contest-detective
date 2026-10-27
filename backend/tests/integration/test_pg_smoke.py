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
