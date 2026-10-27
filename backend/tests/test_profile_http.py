from datetime import datetime, timezone

from contest_detective.system.user.schemas import Profile


def test_match_endpoint_returns_reasons_and_empty_profile_is_empty(client, session, monkeypatch):
    from contest_detective.contest import service
    from contest_detective.contest.schemas import ContestDraft
    from contest_detective.system.user import matching
    monkeypatch.setattr(matching, '_now', lambda: datetime(2026, 10, 24, tzinfo=timezone.utc))
    service.save(session, ContestDraft(name='Python周末', summary='Python应用',
        page={'url': 'https://event.example', 'site': '报名页', 'title': 'Python周末', 'is_official': True},
        claims=[{'field': 'start_at', 'value': '2026-10-31T01:00:00Z', 'excerpt': '10月31日'},
                {'field': 'mode', 'value': 'online', 'excerpt': '线上'}]))
    response = client.post('/match', json={'skills': ['Python']})
    assert response.status_code == 200
    assert response.json()['code'] == 200
    item, = response.json()['data']
    assert item['contest']['name'] == 'Python周末'
    assert 'Python' in item['reason']
    assert client.post('/match', json={}).json()['data'] == []
    assert client.post('/match', json={'skills': ['x'] * 51}).json()['code'] == 400


def test_github_draft_and_raw_resume_draft_do_not_require_login(client):
    from contest_detective.bootstrap.api.profile import get_github_builder, get_resume_extractor

    async def github(username):
        assert username == 'octocat'
        return Profile(github=username, skills=['Python'])

    async def extract(text):
        assert 'Python' in text
        return Profile(skills=['Python'], identity_kind='student')

    client.app.dependency_overrides[get_github_builder] = lambda: github
    client.app.dependency_overrides[get_resume_extractor] = lambda: extract
    first = client.post('/profile/github', json={'username': 'octocat'}).json()
    assert first['code'] == 200
    assert first['data']['github'] == 'octocat'
    second = client.post('/profile/resume?filename=resume.txt', content=b'Python student',
        headers={'Content-Type': 'application/octet-stream'}).json()
    assert second['code'] == 200
    assert second['data']['identity_kind'] == 'student'
    assert client.get('/auth/me').json()['data'] is None


def test_resume_stream_has_size_limit_and_does_not_expose_extractor_errors(client, caplog):
    from contest_detective.bootstrap.api.profile import get_resume_extractor

    async def extract(text):
        raise ValueError('private-contact@example.com')

    client.app.dependency_overrides[get_resume_extractor] = lambda: extract
    large = client.post('/profile/resume?filename=resume.txt', content=b'x' * (2 * 1024 * 1024 + 1))
    assert large.status_code == 200
    assert large.json()['code'] == 400
    invalid = client.post('/profile/resume?filename=resume.txt', content=b'Python student')
    assert invalid.json()['code'] == 503
    assert 'private-contact' not in invalid.text
    assert 'private-contact' not in caplog.text


def test_confirmed_profile_roundtrips_structured_preferences(tmp_path):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from sqlalchemy.orm import sessionmaker
    from account_helpers import Mailbox, request_code
    from contest_detective.framework.db import get_session
    from contest_detective.bootstrap.api.mail import get_mailer
    from contest_detective.bootstrap.app import create_app
    path = tmp_path / 'profile.db'
    engine = create_engine('sqlite:///' + str(path), connect_args={'check_same_thread': False})
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    async_factory = async_sessionmaker(create_async_engine('sqlite+aiosqlite:///' + str(path)), expire_on_commit=False)
    app = create_app(db_engine=engine, async_session_factory=async_factory)
    def session_override():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_session] = session_override
    mailbox = Mailbox()
    app.state.mailbox = mailbox
    app.dependency_overrides[get_mailer] = lambda: mailbox
    with TestClient(app) as browser:
        code = request_code(browser, 'student@example.org')
        browser.post('/auth/register', json={'email': 'student@example.org', 'password': 'password123', 'code': code})
        browser.post('/auth/login', json={'email': 'student@example.org', 'password': 'password123'})
        response = browser.put('/user/profile', json={'skills': ['Python'], 'topics': ['agent'],
            'identity_kind': 'student', 'availability': {'weekdays': [5, 6], 'max_consecutive_days': 2}})
        assert response.json()['code'] == 200
        profile = browser.get('/auth/me').json()['data']['profile']
        assert profile['topics'] == ['agent']
        assert profile['availability']['weekdays'] == [5, 6]
        assert profile['identity_kind'] == 'student'
    engine.dispose()
