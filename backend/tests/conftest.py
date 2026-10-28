import pytest
import time_machine
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from contest_detective.framework.db import Base, get_session, init_db
from contest_detective.bootstrap.app import create_app


@pytest.fixture(autouse=True)
def fixed_current_time():
    with time_machine.travel('2026-10-24T00:00:00Z', tick=False):
        yield


@pytest.fixture
def session_factory():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    init_db(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def session(session_factory):
    with session_factory() as session:
        yield session


@pytest.fixture
def anonymous_client(session_factory):
    app = create_app(db_engine=session_factory.kw['bind'])
    def override():
        with session_factory() as session:
            yield session
    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        yield client


@pytest.fixture
def client(anonymous_client):
    return anonymous_client


@pytest.fixture
def authenticated_client(anonymous_client, session_factory):
    from uuid import UUID
    from contest_detective.system.auth.service import require_user
    from contest_detective.system.user.models import User

    user_id = UUID('00000000-0000-0000-0000-000000000001')
    with session_factory() as session:
        session.add(User(id=user_id, email='transport@example.com', hashed_password='unused', is_verified=True))
        session.commit()
    anonymous_client.app.dependency_overrides[require_user] = lambda: str(user_id)
    yield anonymous_client
    anonymous_client.app.dependency_overrides.pop(require_user, None)
