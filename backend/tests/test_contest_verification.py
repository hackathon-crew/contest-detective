from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from contest_detective.contest.schemas import ClaimIn, PageIn, Source


def source(value, *, url='https://organizer.example/rules', official=False, published=None):
    return Source(url=url, site='来源', title='规则', is_official=official,
                  published_at=published, value=value, excerpt=f'原文：{value}')


def test_postponement_uses_official_date_and_marks_old_reposts():
    from contest_detective.contest.verification import resolve

    old = source('2026-11-10T15:59:59Z', url='https://news.example/old')
    official = source('2026-12-06T15:59:59Z', official=True)
    result = resolve('submission_deadline', [old, official])
    assert (result.value, result.level) == ('2026-12-06T15:59:59Z', 'official')
    assert [(s.url, s.stale) for s in result.sources] == [
        ('https://news.example/old', True), ('https://organizer.example/rules', False)]
    assert old.stale is False


def test_reposted_dates_conflict_at_the_earliest_without_stale_sources():
    from contest_detective.contest.verification import resolve

    result = resolve('registration_deadline', [
        source('2026-12-06T15:59:59Z'), source('2026-11-10T15:59:59Z')])
    assert (result.value, result.level) == ('2026-11-10T15:59:59Z', 'conflict')
    assert all(not s.stale for s in result.sources)


def test_different_text_needs_semantic_review_regardless_of_publication_or_authority():
    from contest_detective.contest.verification import resolve

    old = source('上海', published=datetime(2026, 10, 1, tzinfo=timezone.utc))
    latest = source('北京', url='https://news.example/latest',
                    published=datetime(2026, 10, 2, tzinfo=timezone.utc))
    assert resolve('city', [old, latest]).value is None
    old.is_official = True
    result = resolve('city', [old, latest])
    assert (result.value, result.level) == (None, 'not_found')
    assert not any(source.stale for source in result.sources)


def test_missing_and_consistent_claims_have_distinct_levels():
    from contest_detective.contest.verification import resolve

    assert resolve('prize', []).model_dump() == {'value': None, 'level': 'not_found', 'sources': [], 'precision': 'datetime'}
    result = resolve('mode', [source('online'), source('online', url='https://news.example')])
    assert (result.value, result.level) == ('online', 'reposted')


@pytest.mark.parametrize('url', [
    'https://hackertrip.space/hackathon/1',
    'https://hackathonradar.com/events/1',
])
def test_aggregator_cannot_be_marked_official(url):
    from contest_detective.contest.verification import resolve

    page = PageIn(url=url, site='平台', title='收录页', is_official=True)
    result = resolve('city', [Source(**page.model_dump(), value='上海', excerpt='上海')])
    assert (result.level, result.sources[0].is_official) == ('reposted', False)


def test_date_claim_normalizes_timezone_without_changing_excerpt():
    claim = ClaimIn(field='submission_deadline', value='2026-10-25T16:00:00+08:00',
                    excerpt='16:00 提交截止')
    assert claim.value == '2026-10-25T08:00:00Z'
    assert claim.excerpt == '16:00 提交截止'


@pytest.mark.parametrize('value', ['2026-10-25', '2026-10-25T16:00:00', 'not a date'])
def test_date_claim_rejects_values_without_a_timezone(value):
    with pytest.raises(ValidationError):
        ClaimIn(field='start_at', value=value, excerpt=value)


def test_mode_claim_rejects_unknown_modes():
    with pytest.raises(ValidationError):
        ClaimIn(field='mode', value='remote', excerpt='remote')
