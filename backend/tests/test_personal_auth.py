from account_helpers import account_client
from contest_detective.bootstrap.api.agent import get_investigator
from contest_detective.bootstrap.api.profile import get_github_builder, get_resume_extractor
from contest_detective.system.user.schemas import Profile


def test_guests_cannot_chat_or_process_profile_data(tmp_path):
    calls = []

    async def github(username):
        calls.append('github')
        return Profile(github=username)

    async def resume(text):
        calls.append('resume')
        return Profile()

    def investigator():
        calls.append('model')
        raise AssertionError('authentication must run before model initialization')

    with account_client(tmp_path) as browser:
        browser.app.dependency_overrides[get_github_builder] = lambda: github
        browser.app.dependency_overrides[get_resume_extractor] = lambda: resume
        browser.app.dependency_overrides[get_investigator] = investigator
        for path, body in [('/profile/github', {'username': 'octocat'}), ('/match', {'skills': ['Python']})]:
            response = browser.post(path, json=body)
            assert response.json().get('code') == 401
        response = browser.post('/profile/resume?filename=resume.txt', content=b'Python student')
        assert response.json()['code'] == 401
        assert browser.post('/agent/ask', json={'question': '帮我找比赛'}).json()['code'] == 401
        browser.cookies.set('cd_investigator', 'old-guest')
        assert browser.get('/agent/investigations/old-guest/events').json()['code'] == 401
        assert browser.post('/agent/investigations/old-guest/cancel').json()['code'] == 401
        assert browser.get('/account/conversations').json()['code'] == 401
        assert browser.post('/account/conversations/import', json={'sessions': []}).json()['code'] == 401
        assert calls == []
        assert browser.get('/contests').json()['code'] == 200
