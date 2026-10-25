from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from contest_detective.server.contest.events import ContestChange, ContestSnapshot
from contest_detective.server.notifications.watch.contracts import (
    WatchCursor, WatchNotification, WatchStatus, WatchSubscription,
)
from contest_detective.server.research_pipeline.verification_contracts import PageCheck

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


def test_legacy_events_do_not_invent_snapshots():
    assert ContestChange().model_dump() == {'before': None, 'after': None}


def test_watch_defaults_to_paused_and_has_its_own_cursor():
    user_id = uuid4()
    assert not WatchSubscription(user_id=user_id, contest_id='c').enabled
    assert WatchCursor(user_id=user_id).event_id == 0
    status = WatchStatus(contest_id='c', enabled=True, state='scheduler_paused')
    assert status.last_check is None and status.next_check_at is None


def test_snapshot_keeps_observed_values_sources_and_precision():
    snapshot = ContestSnapshot(name='比赛', fields={'registration_deadline': {
        'value': '2026-11-01T00:00:00Z', 'precision': 'day', 'level': 'official',
        'sources': [{'url': 'https://example.org/rules', 'site': '主办方', 'title': '规则',
                     'is_official': True, 'value': '2026-11-01T00:00:00Z',
                     'precision': 'day', 'excerpt': '11月1日截止'}],
    }})
    notification = WatchNotification(user_id=uuid4(), event_id=1, contest_id='c',
        occurred_at=NOW, change=ContestChange(before=snapshot, after=snapshot))
    assert WatchNotification.model_validate_json(notification.model_dump_json()) == notification
    assert notification.change.before.fields['registration_deadline'].sources[0].excerpt == '11月1日截止'


@pytest.mark.parametrize('outcome', ['success', 'cached', 'complete'])
def test_check_outcomes_do_not_mislabel_unobserved_work(outcome):
    with pytest.raises(ValidationError):
        PageCheck(contest_id='c', checked_at=NOW, outcome=outcome)


def test_check_requires_observed_timezone_aware_time():
    with pytest.raises(ValidationError):
        PageCheck(contest_id='c', checked_at=datetime(2026, 10, 25), outcome='unchanged')


def test_snapshot_rejects_unknown_fact_names():
    with pytest.raises(ValidationError):
        ContestSnapshot(name='比赛', fields={'invented_fact': {'value': 'yes', 'level': 'official'}})


@pytest.mark.parametrize('state,enabled,next_at', [
    ('paused', False, NOW), ('scheduled', False, NOW),
    ('scheduled', True, None), ('scheduler_paused', True, NOW),
])
def test_watch_status_rejects_contradictory_scheduling(state, enabled, next_at):
    with pytest.raises(ValidationError):
        WatchStatus(contest_id='c', state=state, enabled=enabled, next_check_at=next_at)


def test_success_requires_source_and_actual_completion():
    with pytest.raises(ValidationError):
        PageCheck(contest_id='c', checked_at=NOW, completed_at=NOW, outcome='unchanged')
    with pytest.raises(ValidationError):
        PageCheck(contest_id='c', checked_at=NOW, outcome='changed', source_url='https://example.org')
    value = PageCheck(contest_id='c', checked_at=NOW, completed_at=NOW,
        outcome='unchanged', source_url='https://example.org')
    assert PageCheck.model_validate_json(value.model_dump_json()) == value


def test_status_rejects_another_contests_check():
    check = PageCheck(contest_id='other', checked_at=NOW, completed_at=NOW, outcome='no_source')
    with pytest.raises(ValidationError):
        WatchStatus(contest_id='c', state='paused', last_check=check)


@pytest.mark.parametrize('outcome,source,error', [
    ('changed', 'https://example.org', 'TimeoutError'),
    ('failed', 'https://example.org', None),
    ('no_source', 'https://example.org', None),
    ('no_source', None, 'TimeoutError'),
])
def test_check_rejects_contradictory_outcomes(outcome, source, error):
    with pytest.raises(ValidationError):
        PageCheck(contest_id='c', checked_at=NOW, completed_at=NOW,
            outcome=outcome, source_url=source, error_type=error)
