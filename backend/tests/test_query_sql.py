from datetime import datetime, timezone

from sqlalchemy import event, select

from contest_detective.contest import service
from contest_detective.contest.models import ContestDetails
from contest_detective.contest.schemas import ContestDraft, ContestQuery


def save(session, name, *, url=None, claims=None):
    return service.save(session, ContestDraft(name=name, page={
        'url': url or f'https://host.example/{name}', 'site': '主办方', 'title': name, 'is_official': True,
    }, claims=claims or []))


def test_query_loads_evidence_for_the_requested_page_only(session, monkeypatch):
    for index in reversed(range(12)):
        save(session, f'赛事{index:02}', claims=[{'field': 'start_at', 'value': '2026-10-29', 'precision': 'day', 'excerpt': '10月29日'}])
    read = []
    summary = service._summary

    def observe(*args):
        read.append(args[1].name)
        return summary(*args)

    monkeypatch.setattr(service, '_summary', observe)
    statements = []

    def capture(_, __, statement, *___):
        statements.append(statement)

    event.listen(session.get_bind(), 'before_cursor_execute', capture)
    try:
        items, total = service.query(session, ContestQuery(sort='start', status='upcoming', page=2, page_size=3))
    finally:
        event.remove(session.get_bind(), 'before_cursor_execute', capture)
    assert total == 12 and [item.name for item in items] == ['赛事03', '赛事04', '赛事05']
    assert read == ['赛事03', '赛事04', '赛事05']
    assert any('count(' in statement.lower() for statement in statements)
    assert any('LIMIT' in statement and 'OFFSET' in statement for statement in statements)


def test_query_keeps_literal_keyword_matching_and_binary_name_ties(session):
    for name in ('a', 'Z', 'A_100%', 'A-100x'):
        save(session, name)
    assert [item.name for item in service.query(session, ContestQuery())[0]] == ['A-100x', 'A_100%', 'Z', 'a']
    for keyword in ('_', '%'):
        assert [item.name for item in service.query(session, ContestQuery(keyword=keyword))[0]] == ['A_100%']


def test_query_blocks_source_domains_before_counting_and_paginating(session):
    save(session, '保留A')
    save(session, '屏蔽', url='https://Blog.Blocked.Example.:8443/rules',
         claims=[{'field': 'city', 'value': '上海', 'excerpt': '上海'}])
    save(session, '保留B', url='https://notblocked.example/rules')
    items, total = service.query(session, ContestQuery(page_size=1, page=2), blocked_domains=['blocked.example'])
    assert total == 2 and [item.name for item in items] == ['保留B']


def test_date_filter_distinguishes_day_closure_from_an_exact_instant(session):
    save(session, '只给日期', claims=[{'field': 'registration_deadline', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日'}])
    save(session, '给了时刻', claims=[{'field': 'registration_deadline', 'value': '2026-10-27T16:00:00Z', 'excerpt': '10月28日零点'}])
    items, total = service.query(session, ContestQuery(date_from='2026-10-27T16:00:00Z'))
    assert total == 1 and [item.name for item in items] == ['给了时刻']
    assert service.query(session, ContestQuery(date_from='2026-10-27T16:00:00.000001Z')) == ([], 0)


def test_derived_date_bounds_refresh_when_a_source_changes_precision_or_removes_a_date(session):
    contest_id = save(session, '会更新的日期', claims=[
        {'field': 'submission_deadline', 'value': '2026-10-27', 'precision': 'day', 'excerpt': '10月27日'}])
    details = session.get(ContestDetails, contest_id)
    assert datetime.fromtimestamp(details.submission_deadline_upper / 1_000_000, timezone.utc).isoformat() == '2026-10-27T16:00:00+00:00'
    save(session, '会更新的日期', claims=[
        {'field': 'submission_deadline', 'value': '2026-10-27T08:00:00Z', 'excerpt': '下午4点'}])
    details = session.get(ContestDetails, contest_id)
    assert details.submission_deadline_lower == details.submission_deadline_upper
    save(session, '会更新的日期', claims=[{'field': 'city', 'value': '上海', 'excerpt': '上海'}])
    details = session.scalar(select(ContestDetails).where(ContestDetails.contest_id == contest_id))
    assert details.submission_deadline_lower is None and details.submission_deadline_upper is None
