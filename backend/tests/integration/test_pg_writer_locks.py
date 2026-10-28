import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
from threading import Barrier

import pytest
from pydantic_ai.usage import RequestUsage
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from contest_detective.agent.budget import Budget
from contest_detective.agent.config import LLMSettings
from contest_detective.agent.models import LLMUsage
from contest_detective.framework.db import init_db
from contest_detective.framework.exceptions import BizException
from contest_detective.system.account.schemas import MailPreview
from contest_detective.system.notifications.service import deliver
from contest_detective.system.user.models import User

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')

pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


@pytest.fixture
def factory():
    engine = create_engine(PG_URL, future=True)
    init_db(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


def test_postgres_budget_reserves_settles_and_cancels(factory):
    budget = Budget(factory, LLMSettings(_env_file=None, enabled=True, api_key='test-only', budget_cny=Decimal('5')))
    ids = []
    try:
        ids.append(budget.reserve())
        budget.settle(ids[-1], RequestUsage(input_tokens=3000, cache_read_tokens=1000, output_tokens=500))
        ids.append(budget.reserve())
        budget.cancel_before_request(ids[-1])
        with factory() as session:
            assert [session.get(LLMUsage, call_id).status for call_id in ids] == ['settled', 'cancelled']
    finally:
        with factory() as session:
            session.execute(delete(LLMUsage).where(LLMUsage.id.in_(ids)))
            session.commit()


def test_postgres_budget_approves_the_last_remainder_once(factory):
    # One reservation is 0.196608 CNY at default limits, so 0.3 fits exactly one.
    budget = Budget(factory, LLMSettings(_env_file=None, enabled=True, api_key='test-only', budget_cny=Decimal('0.3')))
    barrier = Barrier(2)

    def reserve():
        barrier.wait()
        try:
            return budget.reserve()
        except BizException:
            return None

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: reserve(), range(2)))
    ids = [call_id for call_id in results if call_id]
    try:
        assert len(ids) == 1
    finally:
        with factory() as session:
            session.execute(delete(LLMUsage).where(LLMUsage.id.in_(ids)))
            session.commit()


class Mailbox:
    def __init__(self):
        self.sent = []

    def send(self, message):
        self.sent.append(message)


def test_postgres_mail_delivery_claims_each_message_once(factory):
    user_id = uuid.uuid4()
    email = f'{user_id.hex}@example.com'
    message = MailPreview(subject='提醒', html='<p>提醒</p>', text='提醒', sender='noreply@example.com', recipient=email)
    mailbox = Mailbox()
    now = datetime.now(timezone.utc)
    try:
        with factory() as session:
            user = User(id=user_id, email=email, hashed_password='not-used', is_active=True)
            session.add(user)
            session.commit()
            assert deliver(session, user, mailbox, message, key='pg-lock-test', kind='test', now=now)
            assert not deliver(session, user, mailbox, message, key='pg-lock-test', kind='test', now=now)
        assert len(mailbox.sent) == 1
    finally:
        with factory() as session:
            session.execute(delete(User).where(User.id == user_id))
            session.commit()
