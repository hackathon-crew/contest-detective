import uuid

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from contest_detective.framework.db import init_db


def test_notification_storage_has_durable_owner_scoped_constraints(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "notifications.db"}')
    init_db(engine)
    inspector = inspect(engine)
    expected = {'contest_events', 'notification_pending', 'notification_seen', 'notification_cursors'}
    assert expected <= set(inspector.get_table_names())
    for table in ('notification_pending', 'notification_seen'):
        assert {'users', 'contests'} <= {fk['referred_table'] for fk in inspector.get_foreign_keys(table)}
    from contest_detective.system.notifications.models import PendingNotification
    with Session(engine) as session:
        values = dict(user_id=uuid.uuid4(), contest_id='contest', event_id=1,
                      reason='profile', track_ids=[], version='a' * 64)
        session.add(PendingNotification(**values))
        session.commit()
        session.add(PendingNotification(**values))
        with pytest.raises(IntegrityError):
            session.commit()
    init_db(engine)
    engine.dispose()


def test_delivery_contract_carries_a_stable_idempotency_key():
    from contest_detective.system.notifications.ports import DeliveryReceipt, OutgoingMail
    message = OutgoingMail(key='daily:user:2026-10-25', sender='Inkpaw <hello@example.com>',
                           recipient='reader@example.com', subject='新比赛', html='<p>新比赛</p>', text='新比赛')
    assert message.key == 'daily:user:2026-10-25'
    assert DeliveryReceipt(provider_id='resend-id').provider_id == 'resend-id'
