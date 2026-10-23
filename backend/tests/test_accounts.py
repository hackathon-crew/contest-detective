from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from contest_detective.web.bootstrap.app import create_app


def app_client(tmp_path):
    path=tmp_path/'accounts.db'
    sync=create_engine(f'sqlite:///{path}',connect_args={'check_same_thread':False})
    async_engine=create_async_engine(f'sqlite+aiosqlite:///{path}')
    return TestClient(create_app(db_engine=sync, async_session_factory=async_sessionmaker(async_engine,expire_on_commit=False)))


def test_register_login_profile_and_logout(tmp_path):
    with app_client(tmp_path) as client:
        body={'email':'person@example.com','password':'long-password-123'}
        result=client.post('/auth/register',json=body).json()
        assert result['code']==200
        assert result['data']['username']=='person@example.com'
        assert 'password' not in result['data']
        assert client.post('/auth/register',json=body).json()['code']==409
        assert client.post('/auth/login',json={**body,'password':'wrong'}).json()['code']==401
        login=client.post('/auth/login',json=body)
        assert login.json()['code']==200
        cookie=login.headers['set-cookie'].lower()
        assert 'httponly' in cookie and 'samesite=lax' in cookie
        assert client.get('/auth/me').json()['data']['username']=='person@example.com'
        confirmed=client.put('/user/profile',json={'skills':['Python'],'city':'上海'})
        assert confirmed.json()['data']['profile']['skills']==['Python']
        assert client.post('/auth/logout').json()['code']==200
        assert client.get('/auth/me').json()['data'] is None
        assert client.put('/user/profile',json={'skills':[]}).json()['code']==401


def test_short_password_is_rejected(tmp_path):
    with app_client(tmp_path) as client:
        assert client.post('/auth/register',json={'email':'person@example.com','password':'123'}).json()['code']==400


def test_expired_and_revoked_sessions_stop_authenticating(tmp_path):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import update
    from contest_detective.server.auth.models import AccessToken
    with app_client(tmp_path) as client:
        body={'email':'person@example.com','password':'long-password-123'}
        client.post('/auth/register',json=body)
        client.post('/auth/login',json=body)
        engine=create_engine(f'sqlite:///{tmp_path / "accounts.db"}')
        with engine.begin() as connection:
            connection.execute(update(AccessToken).values(created_at=datetime.now(timezone.utc)-timedelta(days=8)))
        assert client.get('/auth/me').json()['data'] is None
        assert client.post('/auth/logout').json()['code']==200
        assert 'cd_session' not in client.cookies
        engine.dispose()


def test_profile_confirmation_does_not_accept_an_invalid_session(tmp_path):
    with app_client(tmp_path) as client:
        client.cookies.set('cd_session','unrecognized')
        assert client.put('/user/profile',json={'city':'上海'}).json()['code']==401
