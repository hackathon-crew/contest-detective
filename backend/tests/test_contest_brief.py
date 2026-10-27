import json
from datetime import datetime
from typing import get_args

import pytest

from contest_detective.contest import service
from contest_detective.contest.schemas import ContestField, ContestSummary, FieldValue, Source


NOW = datetime.fromisoformat('2026-10-27T15:00:00Z')


def summary():
    fields = {name: FieldValue(value=None, level='not_found') for name in get_args(ContestField)}
    for name, value, precision in [
        ('start_at', '2026-10-27T00:00:00Z', 'day'),
        ('end_at', '2026-10-29T08:30:00Z', 'datetime'),
        ('registration_deadline', '2026-10-26T00:00:00Z', 'day'),
        ('submission_deadline', '2026-10-28T00:00:00Z', 'day'),
        ('city', '上海', 'datetime'), ('mode', 'online', 'datetime'), ('prize', '¥20,000', 'datetime'),
    ]:
        fields[name] = FieldValue(value=value, level='official', precision=precision)
    return ContestSummary(id='00000000-0000-0000-0000-000000000001', name='周末黑客松',
                          status='ongoing', cover_url=None, fields=fields, themes=['AI', 'Web'])


def test_brief_keeps_only_selection_fields_and_literal_date_precision():
    card = service.brief(summary(), now=NOW).model_dump(mode='json')
    assert card == {
        'id': '00000000-0000-0000-0000-000000000001', 'name': '周末黑客松', 'status': 'ongoing',
        'start_at': {'value': '2026-10-27', 'precision': 'day'},
        'end_at': {'value': '2026-10-29T08:30:00Z', 'precision': 'datetime'},
        'next_deadline': {'field': 'submission_deadline', 'value': '2026-10-28', 'precision': 'day'},
        'city': '上海', 'mode': 'online', 'prize': '¥20,000', 'themes': ['AI', 'Web'],
    }


@pytest.mark.parametrize('field', ['registration_deadline', 'submission_deadline', 'deadline_unspecified'])
@pytest.mark.parametrize('clock,expected', [
    ('2026-10-27T15:59:59Z', {'value': '2026-10-27', 'precision': 'day'}),
    ('2026-10-27T16:00:00Z', None),
])
def test_brief_deadline_kind_and_beijing_day_boundary(field, clock, expected):
    item = summary()
    for name in ('registration_deadline', 'submission_deadline', 'deadline_unspecified'):
        item.fields[name] = FieldValue(value=None, level='not_found')
    item.fields[field] = FieldValue(value='2026-10-27T00:00:00Z', precision='day', level='official')
    deadline = service.brief(item, now=datetime.fromisoformat(clock)).model_dump()['next_deadline']
    assert deadline == (dict(field=field, **expected) if expected else None)


def test_brief_ignores_an_expired_exact_deadline_with_the_same_anchor_as_an_available_day():
    item = summary()
    item.fields['registration_deadline'] = FieldValue(value='2026-10-27T00:00:00Z', level='official')
    item.fields['submission_deadline'] = FieldValue(
        value='2026-10-27T00:00:00Z', precision='day', level='official')
    assert service.brief(item, now=NOW).model_dump()['next_deadline'] == {
        'field': 'submission_deadline', 'value': '2026-10-27', 'precision': 'day',
    }


def test_brief_selects_the_nearest_available_deadline_across_kinds():
    item = summary()
    item.fields['registration_deadline'] = FieldValue(value='2026-10-30T00:00:00Z', level='official')
    item.fields['deadline_unspecified'] = FieldValue(value='2026-10-27T16:00:00Z', level='official')
    assert service.brief(item, now=NOW).model_dump()['next_deadline'] == {
        'field': 'deadline_unspecified', 'value': '2026-10-27T16:00:00Z', 'precision': 'datetime',
    }


def test_brief_preserves_exact_deadlines_and_missing_values():
    item = summary()
    item.fields['submission_deadline'] = FieldValue(value='2026-10-27T15:00:00Z', level='official')
    item.fields['start_at'] = item.fields['end_at'] = FieldValue(value=None, level='not_found')
    assert service.brief(item, now=NOW).model_dump()['next_deadline'] == {
        'field': 'submission_deadline', 'value': '2026-10-27T15:00:00Z', 'precision': 'datetime',
    }
    card = service.brief(item, now=datetime.fromisoformat('2026-10-28T00:00:00Z'))
    assert card.next_deadline is None and card.start_at is None and card.end_at is None


def test_brief_preserves_long_identifiers_and_exact_date_representations():
    item = summary()
    item.id = 'imported-contest-' + 'a' * 40
    item.fields['end_at'].value = '2026-10-29T08:30:00.123456+00:00'
    card = service.brief(item, now=NOW)
    assert card.id == item.id
    assert card.end_at.value == '2026-10-29T08:30:00.123456+00:00'


def test_brief_size_does_not_grow_with_sources_excerpts_introduction_or_coverage():
    item = summary()
    before = service.brief(item, now=NOW).model_dump_json()
    sources = [Source(url=f'https://organizer.example/{index}', site='主办方', title='参赛规则',
                      is_official=True, value='¥20,000', excerpt='原文摘录' * 1000) for index in range(100)]
    for value in item.fields.values():
        value.sources = sources
    item.theme_sources = sources
    item.introduction = {'text': '介绍' * 200, 'citations': [
        {'url': source.url, 'content_hash': 'a' * 64, 'excerpt': '原文'} for source in sources]}
    item.coverage.fields['prize'] = {'state': 'found', 'urls': [source.url for source in sources]}
    assert service.brief(item, now=NOW).model_dump_json() == before
    assert len(item.fields['prize'].sources) == 100


@pytest.mark.parametrize('text,limit', [('长', 24_000), ('\x00', 100_000)])
def test_twenty_briefs_have_a_fixed_serialized_size_limit(text, limit):
    item = summary()
    item.name = text * 500
    item.fields['city'].value = text * 10_000
    item.fields['prize'].value = text * 10_000
    item.themes = [text * 1000 for _ in range(100)]
    cards = [service.brief(item, now=NOW).model_dump(mode='json') for _ in range(20)]
    assert len(cards[0]['name']) == 160
    assert len(cards[0]['city']) == 80
    assert len(cards[0]['prize']) == 160
    assert len(cards[0]['themes']) == 6
    assert all(len(theme) == 40 for theme in cards[0]['themes'])
    assert len(json.dumps(cards, ensure_ascii=False)) < limit
