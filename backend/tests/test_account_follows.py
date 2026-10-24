from urllib.parse import urlparse

from account_helpers import account_client, login
from test_profile_matching import contest


def test_follow_merge_is_idempotent_and_preserves_reminder_preferences(tmp_path):
    with account_client(tmp_path) as client:
        assert client.get('/account/follows').json()['code'] == 401
        login(client)
        with client.app.state.test_session_factory() as session:
            key = contest(session, '账号关注比赛')
        body = {'ids': [key, key, 'removed-local-id']}
        rows = client.post('/account/follows/merge', json=body).json()['data']
        assert [row['contest']['id'] for row in rows] == [key]
        assert client.patch('/account/follows/'+key, json={'reminders': False}).json()['data']['reminders'] is False
        assert client.post('/account/follows/merge', json=body).json()['data'][0]['reminders'] is False
        login(client, 'other@example.com')
        assert client.get('/account/follows').json()['data'] == []
        assert client.patch('/account/follows/'+key, json={'reminders': True}).json()['code'] == 404
        client.delete('/account/follows/'+key)
        login(client)
        assert client.get('/account/follows').json()['data'][0]['reminders'] is False


def test_private_calendar_keeps_day_precision_and_reflects_unfollows(tmp_path):
    with account_client(tmp_path) as client:
        user_id = login(client)
        with client.app.state.test_session_factory() as session:
            key = contest(session, '全天截止比赛', deadline='2026-11-03T00:00:00Z', precision={'registration_deadline': 'day'})
        client.put('/account/follows/'+key, json={'reminders': True})
        link = client.get('/account/calendar').json()['data']['url']
        assert link.startswith('webcal://') and user_id not in link
        path = urlparse(link).path.removeprefix('/api')
        response = client.get(path)
        assert response.headers['content-type'].startswith('text/calendar')
        assert 'DTSTART;VALUE=DATE:20261103\r\n' in response.text
        assert 'DTEND;VALUE=DATE:20261104\r\n' in response.text
        assert 'DTSTART:20261103T000000' not in response.text
        assert 'owner@example.com' not in response.text
        client.delete('/account/follows/'+key)
        assert '全天截止比赛' not in client.get(path).text
        assert client.get('/calendar/'+user_id+'.ics').json()['code'] == 404
