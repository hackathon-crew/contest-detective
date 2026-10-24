from datetime import datetime, timezone
import uuid

from sqlalchemy import select

from account_helpers import account_client, login
from test_profile_matching import contest


def test_push_settings_require_login_and_verified_address(tmp_path):
    with account_client(tmp_path) as client:
        assert client.get('/account/push').json()['code'] == 401
        login(client, verified=False)
        assert client.put('/account/push', json={'enabled': True}).json()['code'] == 400
        assert client.get('/account/push').json()['data']['settings']['enabled'] is False


def test_push_and_tracks_are_owned_and_parse_once(tmp_path):
    from contest_detective.web.api.account_push import get_tracking_parser
    from contest_detective.server.account.schemas import TrackingConditions
    with account_client(tmp_path) as client:
        owner = login(client)
        parsed = []
        async def parser(text, today):
            parsed.append(text)
            return TrackingConditions(modes=['online'], keywords=['AI'])
        client.app.dependency_overrides[get_tracking_parser] = lambda: parser
        settings = client.put('/account/push', json={'enabled': True, 'frequency': 'daily', 'time': '09:00'}).json()
        assert settings['data']['settings']['time'] == '09:00'
        track = client.post('/account/tracks', json={'text': '线上 AI 比赛'}).json()['data']
        assert track['conditions']['modes'] == ['online']
        assert parsed == ['线上 AI 比赛']
        login(client, 'other@example.com')
        assert client.get('/account/tracks').json()['data'] == []
        assert client.patch('/account/tracks/' + track['id'], json={'enabled': False}).json()['code'] == 404
        assert client.delete('/account/tracks/' + track['id']).json()['code'] == 404
        login(client)
        assert client.patch('/account/tracks/' + track['id'], json={'enabled': False}).json()['data']['enabled'] is False
        assert client.delete('/account/tracks/' + track['id']).json()['code'] == 200
        assert client.get('/account/tracks').json()['data'] == []


def test_structured_tracking_filters_dates_modes_city_and_prize(session):
    from contest_detective.server.notifications.tracking import matching_contests
    from contest_detective.server.account.schemas import TrackingConditions
    target = contest(session, 'AI线上', deadline='2027-11-20T00:00:00Z', start='2027-11-21T01:00:00Z', end='2027-11-22T10:00:00Z', extra={'prize': '10000 元'})
    contest(session, 'AI线下', mode='offline', deadline='2027-11-20T00:00:00Z')
    contest(session, '游戏线上', deadline='2027-12-01T00:00:00Z')
    q = TrackingConditions(keywords=['AI'], modes=['online'], city='上海', has_prize=True,
                           deadline_from='2027-11-01', deadline_to='2027-11-30')
    assert [item.id for item in matching_contests(session, q, datetime(2027, 10, 1, tzinfo=timezone.utc))] == [target]


def test_scheduler_uses_beijing_time_and_claims_a_daily_delivery_once(tmp_path, monkeypatch):
    from contest_detective.server.notifications.service import dispatch_due
    from contest_detective.server.account.models import MailDelivery
    from contest_detective.server.user import matching
    from contest_detective.server.contest import service
    now = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(matching, '_now', lambda: now)
    monkeypatch.setattr(service, '_now', lambda: now)
    with account_client(tmp_path) as client:
        login(client)
        client.put('/user/profile', json={'skills': ['AI']})
        client.put('/account/push', json={'enabled': True, 'frequency': 'daily', 'time': '09:00'})
        factory = client.app.state.test_session_factory
        with factory() as session:
            key=contest(session, 'AI应用比赛')
            session.commit()
        class Mailbox:
            def __init__(self): self.messages = []
            def send(self, message): self.messages.append(message)
        mailbox = Mailbox()
        assert dispatch_due(factory, mailbox, now.replace(hour=0, minute=59)) == 0
        assert dispatch_due(factory, mailbox, now) == 1
        assert dispatch_due(factory, mailbox, now) == 0
        with factory() as session:
            delivery = session.scalar(select(MailDelivery))
            assert delivery.status == 'sent'
            assert 'AI应用比赛' in delivery.html
        assert len(mailbox.messages) == 1


def test_test_mail_failure_is_recorded_without_claiming_success(tmp_path):
    from contest_detective.web.api.account_push import get_mailer
    with account_client(tmp_path) as client:
        login(client)
        class Broken:
            def send(self, message): raise OSError('SMTP unavailable')
        client.app.dependency_overrides[get_mailer] = lambda: Broken()
        assert client.post('/account/push/test').json()['code'] == 503
        history = client.get('/account/push/history').json()['data']
        assert len(history) == 1
        assert history[0]['status'] == 'failed'
        assert history[0]['created_at'].endswith('Z')
        assert 'SMTP unavailable' not in str(history)


def test_same_verified_fact_does_not_notify_for_a_source_excerpt_change(session):
    from contest_detective.server.notifications.service import fingerprint
    from contest_detective.server.contest import service
    key = contest(session, '来源更新')
    item = service.get(session, key)
    before = fingerprint(item)
    item.fields['city'].sources[0].excerpt = '上海市，来源补全了标点'
    assert fingerprint(item) == before


def test_deadline_reminders_run_independently_and_respect_per_contest_switch(tmp_path):
    from contest_detective.server.notifications.service import dispatch_due, fingerprint
    from contest_detective.server.account.models import Follow
    from contest_detective.server.contest import service
    with account_client(tmp_path) as client:
        user_id = login(client)
        client.put('/account/push', json={'enabled': True, 'frequency': 'daily', 'time': '23:00', 'reminder_days': [3, 1]})
        factory = client.app.state.test_session_factory
        with factory() as session:
            key = contest(session, '关注的日精度比赛', deadline='2026-10-28T00:00:00Z', precision={'registration_deadline': 'day'})
            session.add(Follow(user_id=uuid.UUID(user_id), contest_id=key, reminders=True, last_fingerprint=fingerprint(service.get(session, key))))
            session.commit()
        class Mailbox:
            def send(self, message): assert '关注的日精度比赛' in message.html
        mailbox = Mailbox()
        assert dispatch_due(factory, mailbox, datetime(2026, 10, 24, 23, 59, tzinfo=timezone.utc)) == 0
        assert dispatch_due(factory, mailbox, datetime(2026, 10, 25, 0, 0, tzinfo=timezone.utc)) == 1
        assert dispatch_due(factory, mailbox, datetime(2026, 10, 25, 0, 1, tzinfo=timezone.utc)) == 0
        with factory() as session:
            session.get(Follow, (uuid.UUID(user_id), key)).reminders = False
            session.commit()
        assert dispatch_due(factory, mailbox, datetime(2026, 10, 27, 0, 0, tzinfo=timezone.utc)) == 0


def test_next_send_uses_beijing_weekday_and_rolls_after_the_selected_time():
    from contest_detective.server.notifications.service import next_send
    from contest_detective.server.account.schemas import PushSettings
    config = PushSettings(enabled=True, frequency='weekly', weekday=0, time='08:00')
    assert next_send(config, datetime(2026, 10, 25, 23, 59, tzinfo=timezone.utc)).isoformat() == '2026-10-26T08:00:00+08:00'
    assert next_send(config, datetime(2026, 10, 26, 0, 0, tzinfo=timezone.utc)).isoformat() == '2026-11-02T08:00:00+08:00'
    config.frequency = 'instant'
    assert next_send(config, datetime(2026, 10, 25, tzinfo=timezone.utc)) is None


def test_digest_only_calls_verified_ingestion_dates_new(tmp_path, monkeypatch):
    from datetime import timedelta
    from contest_detective.server.user import matching
    from contest_detective.server.user.models import User
    from contest_detective.server.contest import service
    from contest_detective.server.contest.models import ContestEvent
    from contest_detective.server.notifications.service import preview
    now = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(matching, '_now', lambda: now)
    monkeypatch.setattr(service, '_now', lambda: now)
    with account_client(tmp_path) as client:
        owner_id = login(client)
        client.put('/user/profile', json={'skills': ['AI']})
        client.put('/account/push', json={'enabled': True, 'frequency': 'daily'})
        with client.app.state.test_session_factory() as session:
            old_id = contest(session, 'AI旧收录')
            new_id = contest(session, 'AI新收录')
            session.scalar(select(ContestEvent).where(ContestEvent.contest_id == old_id)).occurred_at = now - timedelta(days=8)
            session.scalar(select(ContestEvent).where(ContestEvent.contest_id == new_id)).occurred_at = now - timedelta(minutes=10)
            session.commit()
            message = preview(session, session.get(User, uuid.UUID(owner_id)), now)
            assert 'AI新收录' in message.html
            assert 'AI旧收录' not in message.html


def test_track_results_and_undo_stay_scoped_to_the_owner(tmp_path):
    from contest_detective.web.api.account_push import get_tracking_parser
    from contest_detective.server.account.schemas import TrackingConditions
    with account_client(tmp_path) as client:
        login(client)
        async def parser(text, today): return TrackingConditions(keywords=['AI'], modes=['online'])
        client.app.dependency_overrides[get_tracking_parser] = lambda: parser
        with client.app.state.test_session_factory() as session:
            key = contest(session, 'AI条件命中')
            contest(session, '游戏不命中')
        track = client.post('/account/tracks', json={'text': '线上 AI 比赛'}).json()['data']
        matches = client.get('/account/tracks/' + track['id'] + '/matches').json()
        assert matches['data']['ids'] == [key]
        receipt = client.delete('/account/tracks/' + track['id']).json()['data']
        login(client, 'other@example.com')
        assert client.post('/account/tracks/restore', json=receipt).json()['code'] == 404
        login(client)
        restored = client.post('/account/tracks/restore', json=receipt).json()['data']
        assert restored['id'] == track['id']
        assert client.get('/account/tracks').json()['data'][0]['text'] == '线上 AI 比赛'
        assert client.post('/account/tracks/restore', json=receipt).json()['code'] == 404


def test_library_tracking_preserves_structured_filters_without_a_model(tmp_path):
    with account_client(tmp_path) as client:
        login(client)
        with client.app.state.test_session_factory() as session:
            target = contest(session, 'AI线下上海', mode='offline')
            contest(session, 'AI线上上海', mode='online')
            contest(session, 'AI线下北京', mode='offline', extra={'city': '北京'})
        track = client.post('/account/tracks/filters', json={'text': '上海的线下 AI 比赛', 'filters': {
            'keyword': 'AI', 'cities': ['上海'], 'modes': ['offline'], 'official': True,
        }}).json()['data']
        assert track['conditions']['library']['cities'] == ['上海']
        assert client.get('/account/tracks/' + track['id'] + '/matches').json()['data']['ids'] == [target]
