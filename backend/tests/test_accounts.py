from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine

from contest_detective.common.exceptions import BizException
from contest_detective.web.api.mail import get_mailer

from account_helpers import account_client as app_client, login, register, request_code


def test_register_login_profile_and_logout(tmp_path):
    with app_client(tmp_path) as client:
        body={'email':'person@example.com','password':'long-password-123'}
        result=register(client, body['email'], body['password'])
        assert result['code']==200
        assert result['data']['username']=='person@example.com'
        assert 'password' not in result['data']
        assert client.post('/auth/register/code',json={'email':body['email']}).json()['code']==409
        assert client.post('/auth/login',json={**body,'password':'wrong'}).json()['code']==401
        login_response=client.post('/auth/login',json=body)
        assert login_response.json()['code']==200
        cookie=login_response.headers['set-cookie'].lower()
        assert 'httponly' in cookie and 'samesite=lax' in cookie
        assert client.get('/auth/me').json()['data']['username']=='person@example.com'
        confirmed=client.put('/user/profile',json={'skills':['Python'],'city':'上海'})
        assert confirmed.json()['data']['profile']['skills']==['Python']
        assert client.post('/auth/logout').json()['code']==200
        assert client.get('/auth/me').json()['data'] is None
        assert client.put('/user/profile',json={'skills':[]}).json()['code']==401


def test_registration_requires_a_single_use_code(tmp_path):
    with app_client(tmp_path) as client:
        email='code@example.com'
        credentials={'email':email,'password':'long-password-123'}
        assert client.post('/auth/register',json=credentials).json()['code']==400
        code=request_code(client, email)
        wrong='000000' if code!='000000' else '111111'
        assert client.post('/auth/register',json={**credentials,'code':wrong}).json()['code']==400
        assert client.post('/auth/register',json={**credentials,'code':code}).json()['code']==200
        assert client.post('/auth/register',json={**credentials,'code':code}).json()['code']==400


def test_registration_code_cooldown_expiry_and_attempt_limit(tmp_path):
    from contest_detective.server.auth.models import RegistrationCode

    with app_client(tmp_path) as client:
        email='bounded@example.com'
        credentials={'email':email,'password':'long-password-123'}
        request_code(client, email)
        assert client.post('/auth/register/code',json={'email':email}).json()['code']==429
        with client.app.state.test_session_factory() as session:
            session.get(RegistrationCode, email).expires_at=datetime.now(timezone.utc)-timedelta(seconds=1)
            session.commit()
        assert client.post('/auth/register',json={**credentials,'code':'000000'}).json()['code']==400
        code=request_code(client, email)
        wrong='999999' if code!='999999' else '888888'
        for _ in range(5):
            assert client.post('/auth/register',json={**credentials,'code':wrong}).json()['code']==400
        with client.app.state.test_session_factory() as session:
            assert session.get(RegistrationCode, email) is None


def test_registration_is_blocked_when_the_code_cannot_be_sent(tmp_path):
    from contest_detective.server.auth.models import RegistrationCode

    class Broken:
        def send(self, message):
            raise BizException('邮件服务还没有配置', code=503)

    with app_client(tmp_path) as client:
        client.app.dependency_overrides[get_mailer]=lambda: Broken()
        assert client.post('/auth/register/code',json={'email':'offline@example.com'}).json()['code']==503
        with client.app.state.test_session_factory() as session:
            assert session.get(RegistrationCode, 'offline@example.com') is None


def test_registration_code_respects_the_shared_mail_quota(tmp_path, monkeypatch):
    from contest_detective.server.auth import registration
    from contest_detective.server.notifications.config import NotificationSettings

    monkeypatch.setattr(
        registration,
        'get_account_runtime_settings',
        lambda: NotificationSettings(mail_daily_limit=0),
    )
    with app_client(tmp_path) as client:
        assert client.post('/auth/register/code',json={'email':'quota@example.com'}).json()['code']==429


def test_short_password_is_rejected(tmp_path):
    with app_client(tmp_path) as client:
        email='person@example.com'
        code=request_code(client, email)
        assert client.post('/auth/register',json={'email':email,'password':'123','code':code}).json()['code']==400


def test_expired_and_revoked_sessions_stop_authenticating(tmp_path):
    from sqlalchemy import update
    from contest_detective.server.auth.models import AccessToken
    with app_client(tmp_path) as client:
        login(client)
        engine=create_engine(f'sqlite:///{tmp_path / "account-center.db"}')
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
