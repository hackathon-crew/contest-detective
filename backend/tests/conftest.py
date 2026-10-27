import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from contest_detective.framework.db import Base, get_session, init_db
from contest_detective.bootstrap.app import create_app


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
def client(session_factory):
    app = create_app(db_engine=session_factory.kw['bind'])
    def override():
        with session_factory() as session:
            yield session
    app.dependency_overrides[get_session] = override
    with TestClient(app) as client:
        yield client
