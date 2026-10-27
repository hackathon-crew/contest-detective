from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import UUID

import pytest
from sqlalchemy import func, select

from account_helpers import account_client, login
from contest_detective.system.account.models import Follow
from contest_detective.contest import service as contests
from contest_detective.contest.models import ContestEvent
from contest_detective.contest.schemas import ContestDraft
from contest_detective.system.notifications.models import ConsumerCursor, PendingNotification
from contest_detective.system.notifications.watch import service
from contest_detective.system.notifications.watch.models import Cursor, Notification, Subscription


def draft(city='上海', *, url='https://organizer.example/watch', name='持续盯梢赛'):
    return ContestDraft(name=name, page={'url': url, 'site': '主办方', 'title': name, 'is_official': True},
        claims=[{'field': 'city', 'value': city, 'excerpt': f'地点：{city}'}])


def save(factory, city, cid=None):
    with factory() as session:
        return contests.save(session, draft(city), contest_id=cid)


def test_event_snapshots_are_detached_and_transactional(session):
    cid = contests.save(session, draft())
    event = session.scalar(select(ContestEvent))
    assert event.before_snapshot is None
    assert event.after_snapshot['fields']['city']['value'] == '上海'
    contests.save(session, draft('北京'), contest_id=cid, commit=False)
    pending = session.scalars(select(ContestEvent).order_by(ContestEvent.id)).all()[-1]
    assert pending.before_snapshot['fields']['city']['value'] == '上海'
    assert pending.after_snapshot['fields']['city']['value'] == '北京'
    assert pending.before_snapshot['fields']['city']['sources'][0]['excerpt'] == '地点：上海'
    session.rollback()
    session.expunge(pending)
    assert session.scalar(select(func.count()).select_from(ContestEvent)) == 1
    assert contests.get(session, cid).fields['city'].value == '上海'
    contests.save(session, draft('广州'), contest_id=cid)
    session.refresh(event)
    assert event.after_snapshot['fields']['city']['value'] == '上海'


def test_watch_is_account_private_and_independent_from_email(tmp_path):
    with account_client(tmp_path) as client:
        assert client.get('/account/watch').json()['code'] == 401
        a = UUID(login(client))
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        assert client.put('/account/watch/'+cid, json={'enabled': True}).json()['code'] == 404
        client.put('/account/follows/'+cid, json={})
        state = client.get('/account/watch').json()['data']
        assert state['items'][0]['state'] == 'paused'
        assert state['items'][0]['last_check'] is None
        assert state['items'][0]['next_check_at'] is None
        with factory() as session:
            session.add(ConsumerCursor(name='mail', event_id=1))
            old_fingerprint = session.get(Follow, (a, cid)).last_fingerprint
            session.commit()
        state = client.put('/account/watch/'+cid, json={'enabled': True}).json()['data']
        assert state['enabled'] and state['state'] == 'scheduler_paused'
        assert state['next_check_at'] is None
        save(factory, '北京', cid)
        # Repeating enabled=True must not move the activation baseline past this event.
        client.put('/account/watch/'+cid, json={'enabled': True})
        response = client.get('/account/watch')
        assert response.headers['cache-control'] == 'private, no-store'
        rows = response.json()['data']['notifications']
        assert len(rows) == 1
        item = rows[0]
        assert item['change']['before']['fields']['city']['value'] == '上海'
        assert item['change']['after']['fields']['city']['value'] == '北京'
        assert item['change']['after']['fields']['city']['sources'][0]['url'] == 'https://organizer.example/watch'
        event_id = item['event_id']
        b = UUID(login(client, 'other@example.com'))
        assert client.get('/account/watch').json()['data']['notifications'] == []
        assert client.post(f'/account/watch/notifications/{event_id}/read').json()['code'] == 404
        assert client.put('/account/watch/'+cid, json={'enabled': False}).json()['code'] == 404
        login(client)
        assert client.post(f'/account/watch/notifications/{event_id}/read').json()['code'] == 200
        first_read = client.get('/account/watch').json()['data']['notifications'][0]['read_at']
        client.post(f'/account/watch/notifications/{event_id}/read')
        assert client.get('/account/watch').json()['data']['notifications'][0]['read_at'] == first_read
        with factory() as session:
            assert session.get(ConsumerCursor, 'mail').event_id == 1
            assert session.get(Follow, (a, cid)).last_fingerprint == old_fingerprint
            assert session.scalar(select(func.count()).select_from(PendingNotification)) == 0
            assert session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == b)) == 0


def test_pause_resume_unfollow_and_legacy_events_do_not_create_fake_changes(tmp_path):
    with account_client(tmp_path) as client:
        user = UUID(login(client))
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        client.put('/account/follows/'+cid, json={})
        client.put('/account/watch/'+cid, json={'enabled': True})
        with factory() as session:
            session.add(ContestEvent(contest_id=cid, kind='updated', version='legacy'))
            session.commit()
        assert client.get('/account/watch').json()['data']['notifications'] == []
        client.put('/account/watch/'+cid, json={'enabled': False})
        save(factory, '北京', cid)
        client.put('/account/watch/'+cid, json={'enabled': True})
        assert client.get('/account/watch').json()['data']['notifications'] == []
        save(factory, '广州', cid)
        assert len(client.get('/account/watch').json()['data']['notifications']) == 1
        client.delete('/account/follows/'+cid)
        save(factory, '深圳', cid)
        assert len(client.get('/account/watch').json()['data']['notifications']) == 1
        with factory() as session:
            assert session.get(Subscription, (user, cid)) is None
        client.put('/account/follows/'+cid, json={})
        assert client.get('/account/watch').json()['data']['items'][0]['state'] == 'paused'


def test_concurrent_consumers_are_idempotent(tmp_path):
    with account_client(tmp_path) as client:
        user = UUID(login(client))
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        client.put('/account/follows/'+cid, json={})
        client.put('/account/watch/'+cid, json={'enabled': True})
        for city in ['北京', '广州', '深圳']:
            save(factory, city, cid)
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda _: service.consume(factory, user), range(4)))
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Notification)) == 3
            assert session.get(Cursor, user).event_id == session.scalar(select(func.max(ContestEvent.id)))


def test_bounded_consumption_and_notification_pagination(session_factory):
    from contest_detective.system.user.models import User
    user_id = UUID('11111111-1111-1111-1111-111111111111')
    with session_factory() as session:
        session.add(User(id=user_id, email='pages@example.com', hashed_password='not-used', is_active=True))
        cid = contests.save(session, draft())
        session.add(Follow(user_id=user_id, contest_id=cid))
        session.commit()
        service.set_enabled(session, user_id, cid, True)
        snapshot = {'name': '持续盯梢赛', 'fields': {}}
        for i in range(105):
            session.add(ContestEvent(contest_id=cid, kind='updated', version=str(i),
                before_snapshot=snapshot, after_snapshot={**snapshot, 'name': f'赛事{i}'}))
        session.commit()
    assert service.consume(session_factory, user_id, limit=3) == 3
    with session_factory() as session:
        assert service.read(session, user_id).has_more
    service.consume(session_factory, user_id)
    with session_factory() as session:
        first = service.read(session, user_id)
        assert len(first.notifications) == 100 and first.has_more_notifications and not first.has_more
        last = service.read(session, user_id, before_event_id=first.notifications[-1].event_id)
        assert len(last.notifications) == 5 and not last.has_more_notifications


def test_account_export_and_delete_cover_watch_data(tmp_path):
    from contest_detective.system.account.lifecycle import delete_account, export_account
    with account_client(tmp_path) as client:
        user = UUID(login(client))
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        client.put('/account/follows/'+cid, json={})
        client.put('/account/watch/'+cid, json={'enabled': True})
        save(factory, '北京', cid)
        client.get('/account/watch')
        with factory() as session:
            data = export_account(session, str(user))
            assert len(data['watch']['notifications']) == 1
            assert data['watch']['subscriptions'][0]['enabled']
            delete_account(session, str(user), 'owner@example.com')
            for model in (Subscription, Cursor, Notification):
                assert session.scalar(select(func.count()).select_from(model)) == 0
            assert contests.get(session, cid) is not None


def test_consumer_rollback_keeps_cursor_and_notifications_together(tmp_path):
    from sqlalchemy.orm import Session, sessionmaker
    with account_client(tmp_path) as client:
        user = UUID(login(client))
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        client.put('/account/follows/'+cid, json={})
        client.put('/account/watch/'+cid, json={'enabled': True})
        save(factory, '北京', cid)
        class FailingSession(Session):
            def commit(self):
                raise RuntimeError('simulated interruption')
        broken = sessionmaker(bind=factory.kw['bind'], class_=FailingSession)
        with pytest.raises(RuntimeError, match='interruption'):
            service.consume(broken, user)
        with factory() as session:
            assert session.get(Cursor, user).event_id == 0
            assert session.scalar(select(func.count()).select_from(Notification)) == 0
        service.consume(factory, user)
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(Notification)) == 1


def test_shared_page_updates_keep_each_contests_own_before_snapshot(session):
    first = contests.save(session, draft('上海', name='赛事甲'))
    second = contests.save(session, draft('北京', name='赛事乙'))
    # A shared page's authority change refreshes both contests, not just the edited one.
    changed = draft('广州', name='赛事甲')
    changed.page.is_official = False
    contests.save(session, changed, contest_id=first)
    events = session.scalars(select(ContestEvent).where(ContestEvent.kind == 'updated').order_by(ContestEvent.id)).all()
    a = next(row for row in reversed(events) if row.contest_id == first)
    b = next(row for row in reversed(events) if row.contest_id == second)
    assert a.before_snapshot['fields']['city']['value'] == '上海'
    assert a.after_snapshot['fields']['city']['value'] == '广州'
    assert b.before_snapshot['fields']['city']['value'] == b.after_snapshot['fields']['city']['value'] == '北京'
    assert b.before_snapshot['fields']['city']['level'] == 'official'
    assert b.after_snapshot['fields']['city']['level'] == 'reposted'


def test_reused_session_snapshots_refresh_stale_page_authority(tmp_path):
    from contest_detective.contest.models import ContestPage
    with account_client(tmp_path) as client:
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        with factory() as old, factory() as concurrent:
            retained = old.scalar(select(ContestPage))
            assert retained.is_official
            changed = draft('广州'); changed.page.is_official = False
            contests.save(concurrent, changed, contest_id=cid)
            contests.save(old, draft('北京'), contest_id=cid)
        with factory() as session:
            latest = session.scalars(select(ContestEvent).order_by(ContestEvent.id.desc())).first()
            assert latest.before_snapshot['fields']['city']['value'] == '广州'
            assert latest.before_snapshot['fields']['city']['level'] == 'reposted'
            assert latest.after_snapshot['fields']['city']['level'] == 'official'


def test_concurrent_writers_capture_real_serial_before_state(tmp_path, monkeypatch):
    from threading import Event, current_thread
    from time import sleep
    from contest_detective.contest.events import ContestSnapshot
    with account_client(tmp_path) as client:
        factory = client.app.state.test_session_factory
        cid = save(factory, '上海')
        captured, competing = Event(), Event()
        original = ContestSnapshot.model_dump
        def capture(self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            if current_thread().name.startswith('first') and not captured.is_set():
                captured.set()
                assert competing.wait(5)
                sleep(0.05)
            return result
        monkeypatch.setattr(ContestSnapshot, 'model_dump', capture)
        def first(): return save(factory, '广州', cid)
        def second():
            competing.set()
            return save(factory, '北京', cid)
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='first') as a, ThreadPoolExecutor(max_workers=1) as b:
            one = a.submit(first)
            assert captured.wait(5)
            two = b.submit(second)
            one.result(timeout=10); two.result(timeout=10)
        with factory() as session:
            updates = session.scalars(select(ContestEvent).where(ContestEvent.kind=='updated').order_by(ContestEvent.id)).all()
            assert [(row.before_snapshot['fields']['city']['value'], row.after_snapshot['fields']['city']['value'])
                for row in updates] == [('上海','广州'),('广州','北京')]
