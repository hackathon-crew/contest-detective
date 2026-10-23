from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ContestDraft
from contest_detective.server.user.schemas import Profile

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)


def contest(session, name, *, mode='online', city='上海', start='2026-10-31T01:00:00Z',
            end='2026-11-01T10:00:00Z', deadline='2026-10-30T15:59:59Z', summary='智能体应用赛道',
            extra=None, precision=None):
    claims = {'start_at': start, 'end_at': end, 'registration_deadline': deadline, 'mode': mode, 'city': city, **(extra or {})}
    return service.save(session, ContestDraft(name=name, summary=summary,
        page={'url': 'https://organizer.example/' + name, 'site': '报名页', 'title': name, 'is_official': True},
        claims=[{'field': field, 'value': value, 'excerpt': value, 'precision': (precision or {}).get(field, 'datetime')}
                for field, value in claims.items()]))


def student():
    return Profile(skills=['TypeScript', 'Python'], topics=['agent', 'llm'], identity_kind='student',
        city='北京', preferred_modes=['online'], availability={'weekdays': [5, 6], 'max_consecutive_days': 2},
        github='octocat', github_evidence=[
            {'name': f'agent-{n}', 'url': f'https://github.com/octocat/agent-{n}', 'language': 'Python', 'topics': ['agent']}
            for n in range(3)])


def test_weekend_student_matches_online_agent_track_with_repository_evidence(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    target = contest(session, '线上智能体周末')
    results = matching.match(session, student())
    assert [item.contest.id for item in results] == [target]
    assert '3 个仓库' in results[0].reason
    assert 'agent' in results[0].reason
    assert 'https://github.com/octocat/agent-0' in results[0].reason
    assert '线上' in results[0].reason
    assert results[0].score > 0


def test_professional_only_and_five_day_attendance_are_filtered(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    contest(session, '职场专场', summary='仅限职场开发者参加，智能体应用赛道')
    contest(session, '五天驻场', mode='offline', city='北京', start='2026-10-26T01:00:00Z', end='2026-10-30T10:00:00Z', summary='需连续到场 5 天')
    profile = student().model_copy(update={'preferred_modes': ['online', 'offline']})
    assert matching.match(session, profile) == []


def test_expired_wrong_city_wrong_mode_and_time_conflicts_are_filtered(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    contest(session, '已截止', deadline='2026-10-23T15:59:59Z')
    contest(session, '异地线下', mode='offline', city='上海')
    contest(session, '周一线上', start='2026-10-26T01:00:00Z', end='2026-10-26T10:00:00Z')
    assert matching.match(session, student()) == []
    profile = student().model_copy(update={'preferred_modes': ['online', 'offline']})
    assert matching.match(session, profile) == []


def test_keyword_overlap_ranks_relevant_contest_above_unrelated_contest(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    unrelated = contest(session, '硬件作品', summary='硬件电路和传感器')
    relevant = contest(session, 'Python Agent应用', summary='Python 智能体应用')
    results = matching.match(session, student())
    assert [item.contest.id for item in results] == [relevant, unrelated]
    assert results[0].score > results[1].score


def test_empty_profile_and_unstructured_availability_are_not_claimed_personalized(session):
    from contest_detective.server.user import matching
    contest(session, '活动')
    assert not matching.has_preferences(Profile())
    assert not matching.has_preferences(Profile(github='octocat', available_time='周末'))
    assert matching.match(session, Profile()) == []


def test_explicit_availability_window_must_cover_the_whole_event(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    contest(session, '周末活动')
    profile = Profile(skills=['Python'], availability={'windows': [
        {'start_at': '2026-10-31T00:00:00Z', 'end_at': '2026-10-31T11:00:00Z'}]})
    assert matching.match(session, profile) == []


def test_profile_rejects_unbounded_inputs_naive_windows_and_deceptive_repository_links():
    for values in [
        {'skills': ['python'] * 51},
        {'github': '../users'},
        {'availability': {'weekdays': [7]}},
        {'availability': {'windows': [{'start_at': '2026-10-24T10:00', 'end_at': '2026-10-24T11:00'}]}},
        {'github_evidence': [{'name': 'repo', 'url': 'https://github.com.evil.org/owner/repo', 'topics': []}]},
    ]:
        with pytest.raises(ValidationError):
            Profile.model_validate(values)


def test_explicit_eligibility_field_filters_professional_only_but_keeps_open_entry(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    contest(session, '职业资格', summary='智能体赛道', extra={'eligibility': '仅限职场开发者'})
    open_id = contest(session, '开放资格', summary='智能体赛道', extra={'eligibility': '在校生和职场开发者均可参加'})
    assert [item.contest.id for item in matching.match(session, student())] == [open_id]


def test_open_identity_wording_does_not_create_a_restriction(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    target = contest(session, '开放活动', extra={'eligibility': '不限在校生或职场开发者，均可参加'})
    profile = student().model_copy(update={'identity_kind': 'professional'})
    assert [item.contest.id for item in matching.match(session, profile)] == [target]


def test_explicit_five_day_attendance_requirement_is_filtered_without_event_dates(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    service.save(session, ContestDraft(name='驻场营', summary='智能体应用赛道',
        page={'url': 'https://organizer.example/residency', 'site': '官网', 'title': '驻场营', 'is_official': True},
        claims=[{'field': 'registration_deadline', 'value': '2026-11-01T00:00:00Z', 'excerpt': '11月1日截止'},
                {'field': 'mode', 'value': 'offline', 'excerpt': '线下'},
                {'field': 'entry_requirements', 'value': '需连续到场 5 天', 'excerpt': '需连续到场 5 天'}]))
    profile = student().model_copy(update={'preferred_modes': ['offline']})
    assert matching.match(session, profile) == []
    profile.availability.max_consecutive_days = None
    assert matching.match(session, profile) == []


def test_optional_attendance_wording_does_not_create_a_requirement(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    target = contest(session, '自由参与', extra={'entry_requirements': '无需连续到场 5 天'})
    assert [item.contest.id for item in matching.match(session, student())] == [target]


@pytest.mark.parametrize('deadline_field', ['registration_deadline', 'submission_deadline', 'deadline_unspecified'])
def test_day_deadline_remains_eligible_through_its_civil_date(session, monkeypatch, deadline_field):
    from contest_detective.server.user import matching
    now = datetime(2026, 10, 27, 2, tzinfo=timezone.utc)
    monkeypatch.setattr(matching, '_now', lambda: now)
    monkeypatch.setattr(service, '_now', lambda: now)
    target = contest(session, '今日截止', extra={deadline_field: '2026-10-27T00:00:00Z'}, precision={deadline_field: 'day'})
    contest(session, '昨日截止', extra={deadline_field: '2026-10-26T00:00:00Z'}, precision={deadline_field: 'day'})
    contest(session, '精确时刻已截止', extra={deadline_field: '2026-10-27T01:00:00Z'})
    assert [item.contest.id for item in matching.match(session, student())] == [target]


def test_day_event_matches_a_same_date_window_without_promising_unknown_hours(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    precision = {'start_at': 'day', 'end_at': 'day'}
    target = contest(session, '同日活动', start='2026-10-31T00:00:00Z', end='2026-10-31T00:00:00Z', precision=precision)
    contest(session, '错日活动', start='2026-11-01T00:00:00Z', end='2026-11-01T00:00:00Z', precision=precision)
    profile = Profile(skills=['Python'], availability={'windows': [
        {'start_at': '2026-10-31T04:00:00Z', 'end_at': '2026-10-31T07:00:00Z'}]})
    results = matching.match(session, profile)
    assert [item.contest.id for item in results] == [target]
    assert '具体时刻未核实' in results[0].reason
    assert '已知比赛时间与你确认的可投入时间相符' not in results[0].reason


def test_day_event_does_not_overlap_a_window_ending_at_the_previous_midnight(session, monkeypatch):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    contest(session, '周日活动', start='2026-11-01T00:00:00Z', end='2026-11-01T00:00:00Z',
            precision={'start_at': 'day', 'end_at': 'day'})
    profile = Profile(skills=['Python'], availability={'windows': [
        {'start_at': '2026-10-31T04:00:00Z', 'end_at': '2026-10-31T16:00:00Z'}]})
    assert matching.match(session, profile) == []


@pytest.mark.parametrize('availability', [{'weekdays': [5, 6]}, {'max_consecutive_days': 2}])
def test_day_schedule_preserves_calendar_duration_and_weekday_constraints(session, monkeypatch, availability):
    from contest_detective.server.user import matching
    monkeypatch.setattr(matching, '_now', lambda: NOW)
    precision = {'start_at': 'day', 'end_at': 'day'}
    target = contest(session, '周末两天', start='2026-10-31T00:00:00Z', end='2026-11-01T00:00:00Z', precision=precision)
    contest(session, '持续到周一', start='2026-10-31T00:00:00Z', end='2026-11-02T00:00:00Z', precision=precision)
    profile = Profile(skills=['Python'], availability=availability)
    assert [item.contest.id for item in matching.match(session, profile)] == [target]
