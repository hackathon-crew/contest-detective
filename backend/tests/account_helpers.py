from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.db import get_session
from contest_detective.web.bootstrap.app import create_app


def account_client(tmp_path):
    path = tmp_path / 'account-center.db'
    engine = create_engine(f'sqlite:///{path}', connect_args={'check_same_thread': False})
    factory = sessionmaker(engine, expire_on_commit=False)
    async_engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    app = create_app(db_engine=engine, async_session_factory=async_sessionmaker(async_engine, expire_on_commit=False))
    def session():
        with factory() as value:
            yield value
    app.dependency_overrides[get_session] = session
    app.state.test_session_factory = factory
    return TestClient(app)


def login(client, email='owner@example.com', *, verified=True):
    credentials = {'email': email, 'password': 'long-password-123'}
    client.post('/auth/register', json=credentials)
    client.post('/auth/login', json=credentials)
    if verified:
        from sqlalchemy import select
        from contest_detective.server.user.models import User
        with client.app.state.test_session_factory() as session:
            user = session.scalar(select(User).where(User.email == email))
            user.is_verified = True
            session.commit()
    return client.get('/auth/me').json()['data']['id']
