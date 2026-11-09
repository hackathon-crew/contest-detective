import re
from concurrent.futures import ThreadPoolExecutor

import pytest

from account_helpers import account_client, login

from contest_detective.framework.config.app import get_app_settings
from contest_detective.system.auth import registration


@pytest.fixture
def configured_admin(monkeypatch):
    with monkeypatch.context() as settings:
        settings.setenv('DETECTIVE_INVITE_ADMIN_EMAIL', 'admin@example.org')
        get_app_settings.cache_clear()
        yield
    get_app_settings.cache_clear()


def test_invitation_is_required_before_mail_and_account_creation(tmp_path):
    with account_client(tmp_path) as client:
        email = 'candidate@example.org'
        body = {'email': email, 'invite_code': 'not-an-invitation'}
        assert client.post('/auth/register/code', json=body).json()['code'] == 403
        assert client.post('/auth/register/code', json={'email': email}).json()['code'] == 400
        mailbox = client.app.state.mailbox
        assert not mailbox.messages

        # Simulate an email code sent before the invitation gate was enabled.
        with client.app.state.test_session_factory() as session:
            registration.request_code(session, email, mailbox)
        otp = re.search(r'\b\d{6}\b', mailbox.messages[-1].text).group()
        credentials = {'email': email, 'password': 'long-password-123', 'code': otp}
        assert client.post('/auth/register', json=credentials).json()['code'] == 400
        assert client.post('/auth/register', json={**credentials, **body}).json()['code'] == 403


def test_only_the_configured_verified_account_can_issue_codes(tmp_path, configured_admin):
    with account_client(tmp_path) as client:
        assert client.post('/account/invites').json()['code'] == 401
        login(client, 'member@example.org')
        assert client.get('/account/settings').json()['data']['can_manage_invites'] is False
        assert client.post('/account/invites').json()['code'] == 403
        login(client, 'admin@example.org', verified=False)
        assert client.post('/account/invites').json()['code'] == 403
        login(client, 'admin@example.org')
        assert client.get('/account/settings').json()['data']['can_manage_invites'] is True
        first = client.post('/account/invites')
        second = client.post('/account/invites')
        assert first.headers['Cache-Control'] == 'no-store'
        first_code = first.json()['data']['code']
        assert re.fullmatch(r'[2-9A-HJ-NP-Z]{6}', first_code)
        assert first_code != second.json()['data']['code']


def test_one_invite_can_create_multiple_accounts_even_in_parallel(tmp_path, configured_admin):
    with account_client(tmp_path) as client:
        login(client, 'admin@example.org')
        created = client.post('/account/invites').json()
        assert created['code'] == 200
        invite = created['data']['code']
        client.post('/auth/logout')
        invitation = {'invite_code': invite}
        assert client.post('/auth/register/invite', json={'invite_code': f' {invite.lower()} '}).json()['code'] == 200
        payloads = []
        for email in ('first@example.org', 'second@example.org'):
            assert client.post('/auth/register/code', json={**invitation, 'email': email}).json()['code'] == 200
            otp = re.search(r'\b\d{6}\b', client.app.state.mailbox.messages[-1].text).group()
            payloads.append({**invitation, 'email': email, 'password': 'long-password-123', 'code': otp})

        assert client.post('/auth/register', json={**payloads[0], 'password': 'short'}).json()['code'] == 400
        assert client.post('/auth/register/invite', json=invitation).json()['code'] == 200
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda body: client.post('/auth/register', json=body).json()['code'], payloads))
        assert results == [200, 200]
        assert client.post('/auth/register/invite', json=invitation).json()['code'] == 200
        assert client.post('/auth/register/code', json={**invitation, 'email': 'third@example.org'}).json()['code'] == 200


def test_invited_account_can_chat_past_the_platform_limit(tmp_path, monkeypatch):
    from pydantic_ai.messages import ModelResponse
    from pydantic_ai.models.function import FunctionModel

    from agent_responses import answer_part
    from contest_detective.agent.loop import Investigator
    from contest_detective.bootstrap.api.agent import get_investigator, limiter

    monkeypatch.setattr(get_app_settings(), 'query_limits_enabled', True)
    limiter.reset()
    try:
        with account_client(tmp_path) as client:
            login(client)
            assert client.get('/account/quota').json()['data']['unlimited'] is True
            client.app.dependency_overrides[get_investigator] = lambda: Investigator(
                FunctionModel(lambda *_: ModelResponse([answer_part('本地回答')])),
                session_factory=client.app.state.test_session_factory,
            )
            for _ in range(6):
                assert 'event: answer' in client.post('/agent/ask', json={'question': '找比赛'}).text
    finally:
        limiter.reset()
