from datetime import datetime, timezone

import pytest
from sqlalchemy import inspect, text

from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDraft, ContestQuery

NOW = datetime(2026, 10, 24, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(service, '_now', lambda: NOW, raising=False)


def draft(name='周末黑客松', *, url='https://news.example/event', official=False,
          claims=None, summary=None, published=None):
    return ContestDraft(name=name, summary=summary,
        page={'url': url, 'site': '来源', 'title': name, 'is_official': official,
              'published_at': published},
        claims=[{'field': field, 'value': value, 'excerpt': f'{field}: {value}'}
                for field, value in (claims or {}).items()])


def test_save_preserves_deadline_type_and_detail_evidence(session, session_factory):
    contest_id = service.save(session, draft(claims={
        'start_at': '2026-10-25T00:00:00Z',
        'submission_deadline': '2026-10-25T08:00:00Z', 'mode': 'online'}, summary='限 200 人'))
    with session_factory() as another_session:
        detail = service.get(another_session, contest_id)
    assert detail.summary == '限 200 人'
    assert detail.fields['registration_deadline'].level == 'not_found'
    assert detail.fields['submission_deadline'].value == '2026-10-25T08:00:00Z'
    assert detail.fields['submission_deadline'].sources[0].url == 'https://news.example/event'
    assert detail.status == 'upcoming'
    items, total = service.query(session, ContestQuery())
    assert total == 1
    assert items[0].fields['submission_deadline'].sources == detail.fields['submission_deadline'].sources


def test_fuzzy_names_merge_only_when_start_dates_match(session):
    original = service.save(session, draft('Open Source Hack 2026', claims={'start_at': '2026-11-01T00:00:00Z'}))
    same = service.save(session, draft('Open Source Hack 2026 上海站', url='https://other.example/event',
        claims={'start_at': '2026-11-01T08:00:00Z', 'city': '上海'}))
    other_day = service.save(session, draft('Open Source Hack 2026', url='https://other.example/second',
        claims={'start_at': '2026-11-02T00:00:00Z'}))
    assert same == original
    assert other_day != original
    assert service.query(session, ContestQuery())[1] == 2


def test_sources_with_different_utc_days_merge_on_the_same_beijing_day(session):
    first = service.save(session, draft('开源黑客松', claims={'start_at': '2026-10-31T16:00:00Z'}))
    assert service.save(session, draft('开源黑客松 上海站', url='https://other.example/start',
        claims={'start_at': '2026-11-01T02:00:00Z'})) == first
    next_day = service.save(session, draft('开源黑客松', url='https://other.example/next-day',
        claims={'start_at': '2026-11-01T16:00:00Z'}))
    assert next_day != first


def test_normalized_name_and_repeated_page_are_idempotent(session):
    original = service.save(session, draft('ＨＡＣＫ！ ２０２６', claims={'start_at': '2026-11-01T00:00:00Z'}))
    updated = draft('hack2026', claims={'start_at': '2026-11-01T00:00:00Z', 'city': '上海'})
    assert service.save(session, updated) == original
    assert service.save(session, updated) == original
    detail = service.get(session, original)
    assert len(detail.fields['city'].sources) == 1
    assert session.execute(text('SELECT COUNT(*) FROM contest_pages')).scalar_one() == 1
    assert session.execute(text('SELECT COUNT(*) FROM contest_claims')).scalar_one() == 2


def test_refresh_replaces_all_claims_from_that_page(session):
    contest_id = service.save(session, draft(claims={'start_at': '2026-11-01T00:00:00Z',
        'city': '上海', 'prize': '1 万'}))
    service.save(session, draft(claims={'start_at': '2026-11-01T00:00:00Z', 'city': '北京'}))
    detail = service.get(session, contest_id)
    assert (detail.fields['city'].value, detail.fields['city'].level) == ('北京', 'reposted')
    assert detail.fields['prize'].value is None
    assert len(detail.fields['city'].sources) == 1


def test_page_refresh_can_remove_all_claims_without_creating_duplicates(session):
    contest_id = service.save(session, draft(claims={'city': '上海'}))
    assert service.save(session, draft()) == contest_id
    assert service.save(session, draft()) == contest_id
    assert service.query(session, ContestQuery())[1] == 1
    assert service.get(session, contest_id).fields['city'].value is None


def test_an_undated_page_can_later_supply_the_start_date(session):
    contest_id = service.save(session, draft(claims={'city': '上海'}))
    assert service.save(session, draft(claims={'start_at': '2026-11-01T00:00:00Z'})) == contest_id
    assert service.get(session, contest_id).fields['start_at'].value == '2026-11-01T00:00:00Z'


def test_same_page_can_reschedule_an_existing_contest_without_duplicating_it(session):
    contest_id = service.save(session, draft(claims={'start_at': '2026-11-01T00:00:00Z'}))
    assert service.save(session, draft(claims={'start_at': '2026-11-08T00:00:00Z'})) == contest_id
    detail = service.get(session, contest_id)
    assert detail.fields['start_at'].value == '2026-11-08T00:00:00Z'
    assert len(detail.fields['start_at'].sources) == 1
    assert service.query(session, ContestQuery())[1] == 1


def test_official_postponement_overrides_reposts_after_save(session):
    contest_id = service.save(session, draft(claims={'start_at': '2026-11-01T00:00:00Z',
        'submission_deadline': '2026-11-10T15:59:59Z'}))
    service.save(session, draft(url='https://organizer.example/rules', official=True,
        claims={'start_at': '2026-11-01T00:00:00Z', 'submission_deadline': '2026-12-06T15:59:59Z'}))
    field = service.get(session, contest_id).fields['submission_deadline']
    assert (field.value, field.level) == ('2026-12-06T15:59:59Z', 'official')
    assert {s.url: s.stale for s in field.sources} == {
        'https://news.example/event': True, 'https://organizer.example/rules': False}


def test_date_filter_matches_each_key_date_and_pagination_counts_all(session):
    service.save(session, draft('截止命中', url='https://news.example/deadline', claims={
        'start_at': '2026-11-20T00:00:00Z', 'registration_deadline': '2026-10-25T12:00:00Z'}))
    service.save(session, draft('开赛命中', url='https://news.example/start', claims={
        'start_at': '2026-10-25T06:00:00Z'}))
    service.save(session, draft('结束命中', url='https://news.example/end', claims={
        'start_at': '2026-10-20T00:00:00Z', 'end_at': '2026-10-25T13:00:00Z'}))
    service.save(session, draft('不命中', url='https://news.example/else', claims={
        'start_at': '2026-11-30T00:00:00Z'}))
    result, total = service.query(session, ContestQuery(date_from='2026-10-25T00:00:00Z',
        date_to='2026-10-25T23:59:59Z', sort='start', page=2, page_size=2))
    assert total == 3
    assert [item.name for item in result] == ['截止命中']


def test_filters_can_be_combined_and_empty_ids_mean_no_matches(session):
    chosen = service.save(session, draft('线上周末赛', summary='开源项目',
        claims={'start_at': '2026-10-25T00:00:00Z', 'mode': 'online', 'city': '上海'}))
    service.save(session, draft('线下周末赛', url='https://news.example/offline',
        claims={'start_at': '2026-10-25T00:00:00Z', 'mode': 'offline'}))
    items, total = service.query(session, ContestQuery(keyword='开源', status='upcoming', mode='online', ids=[chosen]))
    assert total == 1
    assert items[0].id == chosen
    assert service.query(session, ContestQuery(ids=[])) == ([], 0)


def test_status_and_next_deadline_are_recomputed_when_time_passes(session, monkeypatch):
    first = service.save(session, draft('先报名再提交', claims={
        'start_at': '2026-10-24T01:00:00Z',
        'registration_deadline': '2026-10-24T00:30:00Z',
        'submission_deadline': '2026-10-24T04:00:00Z'}))
    second = service.save(session, draft('中间截止', url='https://news.example/middle', claims={
        'start_at': '2026-10-26T00:00:00Z', 'deadline_unspecified': '2026-10-24T02:00:00Z'}))
    assert [item.id for item in service.query(session, ContestQuery())[0]] == [first, second]
    monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 24, 1, tzinfo=timezone.utc))
    assert [item.id for item in service.query(session, ContestQuery())[0]] == [second, first]
    assert service.get(session, first).status == 'ongoing'
    assert [item.id for item in service.query(session, ContestQuery(status='ongoing'))[0]] == [first]
    monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 25, 1, tzinfo=timezone.utc))
    assert service.get(session, first).status == 'ended'


def test_unknown_contest_and_invalid_query_use_response_envelope(client):
    response = client.get('/contests/unknown')
    assert response.status_code == 200
    assert response.json()['code'] == 404
    for params in [{'page': 0}, {'page_size': 101}, {'mode': 'remote'}, {'status': 'live'},
                   {'date_from': '2026-11-01', 'date_to': '2026-10-01'}]:
        response = client.get('/contests', params=params)
        assert response.status_code == 200
        assert response.json()['code'] == 400


def test_http_list_and_detail_use_persisted_contests(client, session):
    contest_id = service.save(session, draft(claims={'start_at': '2026-10-25T00:00:00Z'}))
    response = client.get('/contests', params={'ids': contest_id}).json()
    assert response['code'] == 200
    assert response['total'] == 1
    assert response['data'][0]['id'] == contest_id
    detail = client.get(f'/contests/{contest_id}').json()
    assert detail['data']['fields']['start_at']['sources'][0]['url'] == 'https://news.example/event'


def test_migration_creates_foreign_keys_and_unique_source_assertions(session):
    schema = inspect(session.get_bind())
    assert {'contests', 'contest_pages', 'contest_claims'} <= set(schema.get_table_names())
    assert {f['referred_table'] for f in schema.get_foreign_keys('contest_claims')} == {'contests', 'contest_pages'}
    keys = schema.get_pk_constraint('contest_claims')['constrained_columns']
    assert set(keys) == {'contest_id', 'page_id', 'field', 'value'}
