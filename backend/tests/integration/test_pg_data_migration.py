import os
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from contest_detective.agent.models import Investigation, LLMUsage, TraceRecord
from contest_detective.contest import service
from contest_detective.contest.models import ContestEvent
from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.framework.config import DatabaseSettings
from contest_detective.framework.db import Base, init_db, load_models
from contest_detective.framework.sqlite_migration import copy_database
from contest_detective.research.models import PipelineRun
from contest_detective.system.account.models import AccountSettings, Follow, Track
from contest_detective.system.auth.models import AccessToken
from contest_detective.system.notifications.models import (
    PendingNotification,
    RegistrationCodeSend,
    SeenNotification,
)
from contest_detective.system.user.models import User

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')

pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


def settings():
    return DatabaseSettings(
        url=PG_URL, host=None, name=None, user=None, password=None, _env_file=None
    )


def truncate(engine):
    load_models()
    names = ', '.join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    with engine.begin() as connection:
        connection.execute(text(f'TRUNCATE TABLE {names} RESTART IDENTITY CASCADE'))


def seed(path):
    source = create_engine(f'sqlite:///{path}')
    init_db(source)
    factory = sessionmaker(bind=source, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    user_id = UUID('00000000-0000-0000-0000-000000000001')
    with factory() as session:
        session.add(User(id=user_id, email='migration@example.test', hashed_password='x',
                         is_active=True, is_superuser=False, is_verified=True,
                         profile={'skills': ['Python']}, created_at=now))
        session.add(AccessToken(token='synthetic-token', user_id=user_id, created_at=now))
        session.add(AccountSettings(user_id=user_id, push={'enabled': False}, search={}, providers={}))
        track = Track(id=str(uuid4()), user_id=user_id, text='Python events',
                      conditions={'skills': ['Python']}, enabled=True,
                      created_at=now, seen_contests=['later'])
        session.add(track)
        session.add(LLMUsage(id=str(uuid4()), model='deepseek-flash', status='settled',
                             reserved_cny=Decimal('0.1000000000'), cost_cny=Decimal('0.0500000000'),
                             cache_hit_tokens=1, cache_miss_tokens=2, output_tokens=3,
                             created_at=now))
        investigation = Investigation(id=str(uuid4()), question='x' * 708, user_id=str(user_id),
                                      status='completed', answer='done', started_at=now,
                                      finished_at=now)
        session.add(investigation)
        session.add(TraceRecord(investigation_id=investigation.id, seq=1, type='answer',
                                payload={'ok': True}))
        session.add(PipelineRun(job_id='migration-job', ran_on='2026-10-28'))
        session.add(RegistrationCodeSend(email='migration@example.test', created_at=now))
        session.flush()
        contest_id = service.save(session, ContestDraft(
            name='Migration Contest',
            summary='A contest used by the migration test.',
            themes=['AI'],
            page=PageIn(url=f'https://example.test/{uuid4().hex}', site='example',
                        title='Migration Contest', is_official=True),
            claims=[
                ClaimIn(field='start_at', value='2026-11-01T00:00:00Z',
                        excerpt='Start 2026-11-01', precision='datetime'),
                ClaimIn(field='mode', value='online', excerpt='Online', precision='datetime'),
            ],
        ))
        event = session.scalars(
            select(ContestEvent).where(ContestEvent.contest_id == contest_id)
        ).first()
        assert event is not None
        session.add(Follow(user_id=user_id, contest_id=contest_id, reminders=True, created_at=now))
        session.add(PendingNotification(user_id=user_id, contest_id=contest_id, event_id=event.id,
                                        version='v' * 64, reason='track', track_ids=[track.id],
                                        queued_at=now))
        session.add(SeenNotification(user_id=user_id, contest_id=contest_id, version='v' * 64,
                                     sent_at=now))
        session.commit()
    source.dispose()
    return contest_id, user_id


def test_copy_sqlite_to_postgres(tmp_path):
    source_path = tmp_path / 'source.db'
    contest_id, user_id = seed(source_path)
    target = create_engine(PG_URL)
    init_db(target)
    truncate(target)

    report = copy_database(source_path, settings(), apply=True)
    assert report['applied'] is True
    assert report['tables']['contests']['rows'] == 1
    assert report['tables']['users']['rows'] == 1
    assert report['tables']['llm_usage']['rows'] == 1
    assert report['tables']['contest_claims']['rows'] >= 2

    with target.connect() as connection:
        assert connection.execute(text('SELECT count(*) FROM contests')).scalar_one() == 1
        assert connection.execute(
            text("SELECT profile->>'skills' FROM users")
        ).scalar_one() == '["Python"]'
        assert connection.execute(
            text('SELECT count(*) FROM users WHERE id = CAST(:id AS uuid)'), {'id': str(user_id)}
        ).scalar_one() == 1
        assert connection.execute(text('SELECT cost_cny FROM llm_usage')).scalar_one() == Decimal('0.05')
        occurred = connection.execute(text('SELECT occurred_at FROM contest_events')).scalar_one()
        assert occurred.tzinfo is not None
        assert connection.execute(
            text("SELECT payload->>'ok' FROM trace_events")
        ).scalar_one() == 'true'
        assert connection.execute(
            text('SELECT length(question) FROM investigations')
        ).scalar_one() == 708

    with target.begin() as connection:
        next_id = connection.execute(text(
            "INSERT INTO contest_events (contest_id, kind, version, occurred_at) "
            "VALUES (:contest_id, 'updated', :version, now()) RETURNING id"
        ), {'contest_id': contest_id, 'version': 'n' * 64}).scalar_one()
        assert next_id > 1
        connection.execute(text('DELETE FROM contest_events WHERE id = :id'), {'id': next_id})

    truncate(target)
    target.dispose()


def test_failed_copy_rolls_back(tmp_path):
    source_path = tmp_path / 'source.db'
    seed(source_path)
    target = create_engine(PG_URL)
    init_db(target)
    truncate(target)

    def fail_after(name):
        if name == 'contests':
            raise RuntimeError('synthetic copy failure')

    with pytest.raises(RuntimeError, match='synthetic copy failure'):
        copy_database(source_path, settings(), apply=True, on_table_copied=fail_after)

    load_models()
    with target.connect() as connection:
        for table in Base.metadata.sorted_tables:
            assert connection.execute(select(func.count()).select_from(table)).scalar_one() == 0
    truncate(target)
    target.dispose()
