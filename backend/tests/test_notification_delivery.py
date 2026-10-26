from datetime import datetime, timedelta, timezone
import uuid

import pytest
from sqlalchemy import select

from account_helpers import account_client, login
from test_profile_matching import contest


def test_queue_survives_a_failed_send_and_retries_the_same_message(tmp_path, monkeypatch):
    from contest_detective.server.notifications.service import dispatch_due
    from contest_detective.server.notifications.models import ConsumerCursor, PendingNotification, SeenNotification
    from contest_detective.server.account.models import MailDelivery
    from contest_detective.server.contest import service
    from contest_detective.server.user import matching
    now = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(service, '_now', lambda: now)
    monkeypatch.setattr(matching, '_now', lambda: now)
    with account_client(tmp_path) as client:
        user_id = uuid.UUID(login(client))
        client.put('/user/profile', json={'skills': ['AI']})
        client.put('/account/push', json={'enabled': True, 'frequency': 'daily', 'time': '09:00'})
        factory = client.app.state.test_session_factory
        with factory() as session:
            key = contest(session, 'AI待发送比赛')
        class Mailbox:
            def __init__(self): self.messages = []
            def send(self, message):
                self.messages.append(message)
                if len(self.messages) == 1: raise OSError('temporary')
        mailbox = Mailbox()
        assert dispatch_due(factory, mailbox, now) == 0
        with factory() as session:
            assert session.get(PendingNotification, (user_id, key)) is not None
            assert session.get(ConsumerCursor, 'mail').event_id > 0
        assert dispatch_due(factory, mailbox, now+timedelta(minutes=2)) == 1
        assert mailbox.messages[0] == mailbox.messages[1]
        assert dispatch_due(factory, mailbox, now+timedelta(minutes=3)) == 0
        with factory() as session:
            assert session.get(PendingNotification, (user_id, key)) is None
            assert session.get(SeenNotification, (user_id, key)) is not None
            assert session.scalar(select(MailDelivery)).attempts == 2


def test_local_free_budget_stops_before_another_network_request(tmp_path, monkeypatch):
    from contest_detective.server.notifications import service
    from contest_detective.server.notifications.config import NotificationSettings
    from contest_detective.web.api.account_push import get_mailer
    monkeypatch.setattr(service, 'get_account_runtime_settings', lambda: NotificationSettings(mail_daily_limit=2))
    with account_client(tmp_path) as client:
        login(client)
        sent = []
        class Mailbox:
            def send(self, message): sent.append(message)
        client.app.dependency_overrides[get_mailer] = lambda: Mailbox()
        assert client.post('/account/push/test').json()['code'] == 200
        assert client.post('/account/push/test').json()['code'] == 429
        assert len(sent) == 1


def test_resend_webhook_verifies_original_payload_and_timestamp():
    from contest_detective.server.notifications.resend import verify_webhook
    from contest_detective.common.exceptions import BizException
    body = b'{"event_type":"ping","data":{"success":true}}'
    headers = {'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121',
               'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='}
    secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl'
    assert verify_webhook(body, headers, secret, now=1731705121)['data']['success']
    with pytest.raises(BizException): verify_webhook(body+b' ', headers, secret, now=1731705121)
    with pytest.raises(BizException): verify_webhook(body, headers, secret, now=1731705500)


def test_follow_changes_send_before_the_digest_time_and_do_not_repeat(tmp_path, monkeypatch):
    from contest_detective.server.notifications.service import dispatch_due, fingerprint
    from contest_detective.server.account.models import Follow
    from contest_detective.server.contest import service
    from contest_detective.server.contest.schemas import ContestDraft, PageIn, ClaimIn
    now = datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(service, '_now', lambda: now)
    with account_client(tmp_path) as client:
        user_id = uuid.UUID(login(client))
        client.put('/account/push', json={'enabled': True, 'frequency': 'daily', 'time': '23:00', 'deadline_reminders': False})
        factory = client.app.state.test_session_factory
        with factory() as session:
            key = contest(session, '关注的比赛变动')
            session.add(Follow(user_id=user_id, contest_id=key, reminders=True, last_fingerprint=fingerprint(service.get(session, key))))
            session.commit()
            service.save(session, ContestDraft(name='关注的比赛变动', page=PageIn(url='https://official.example.com/changed', site='official', title='变动', is_official=True), claims=[ClaimIn(field='city', value='北京', excerpt='地点改为北京')]), contest_id=key)
        class Mailbox:
            def __init__(self): self.messages = []
            def send(self, message): self.messages.append(message)
        mailbox = Mailbox()
        assert dispatch_due(factory, mailbox, now) == 1
        assert '的信息有变动' in mailbox.messages[0].subject
        assert dispatch_due(factory, mailbox, now+timedelta(minutes=1)) == 0


def test_background_matching_can_exceed_the_interactive_preview_limit(session, monkeypatch):
    from contest_detective.server.user import matching
    from contest_detective.server.user.schemas import Profile
    monkeypatch.setattr(matching, '_now', lambda: datetime(2026, 10, 25, tzinfo=timezone.utc))
    for i in range(21):
        contest(session, f'AI比赛{i}', start=f'2026-11-{i+1:02d}T01:00:00Z', end=f'2026-11-{i+1:02d}T10:00:00Z')
    profile = Profile(skills=['AI'])
    assert len(matching.match(session, profile)) == 20
    assert len(matching.match(session, profile, limit=None)) == 21
