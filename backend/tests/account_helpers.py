import re

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.db import get_session
from contest_detective.system.notifications.ports import DeliveryReceipt
from contest_detective.system.user.models import User
from contest_detective.bootstrap.api.mail import get_mailer
from contest_detective.bootstrap.app import create_app


class Mailbox:
    def __init__(self):
        self.messages = []

    def send(self, message):
        self.messages.append(message)
        return DeliveryReceipt(provider_id=f'test-{len(self.messages)}')


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
    mailbox = Mailbox()
    app.state.mailbox = mailbox
    app.dependency_overrides[get_mailer] = lambda: mailbox
    app.state.test_session_factory = factory
    return TestClient(app)


def request_code(client, email):
    response = client.post('/auth/register/code', json={'email': email}).json()
    assert response['code'] == 200, response
    message = client.app.state.mailbox.messages[-1]
    match = re.search(r'\b(\d{6})\b', message.text)
    assert match, message.text
    return match.group(1)


def register(client, email, password='long-password-123'):
    return client.post('/auth/register', json={
        'email': email, 'password': password, 'code': request_code(client, email),
    }).json()


def login(client, email='owner@example.com', *, verified=True):
    credentials = {'email': email, 'password': 'long-password-123'}
    if client.post('/auth/login', json=credentials).json()['code'] != 200:
        register(client, email)
        client.post('/auth/login', json=credentials)
    with client.app.state.test_session_factory() as session:
        user = session.scalar(select(User).where(User.email == email))
        user.is_verified = verified
        session.commit()
    return client.get('/auth/me').json()['data']['id']
