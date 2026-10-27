import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from contest_detective.framework.config.app import AppSettings
from contest_detective.agent.normalization import LangChainNormalizer, NormalizedContest
from contest_detective.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.contest.service import get, query
from contest_detective.research.normalization import NormalizationInput, merge_normalized
from contest_detective.research.pipeline.execute import run_pipeline
from contest_detective.research.sources.waytoagi import fetch

FIXTURES = Path(__file__).parent / 'fixtures'
EXCERPT = '日期：2026 年 10 月 25 日。活动时间：10:30—19:02'


def test_sync_refines_event_times_independently_of_the_deadline(session_factory):
    event_id = 'e_dda69ae498'
    listing = json.loads((FIXTURES / 'waytoagi.json').read_text())
    listing['items'] = [item for item in listing['items'] if item['id'] == event_id]
    detail = json.loads((FIXTURES / 'waytoagi_details.json').read_text())[event_id]

    def handle(request):
        assert request.url.host == 'events.waytoagi.com'
        assert request.url.path in ('/api/events', f'/api/events/{event_id}')
        return httpx.Response(200, json=listing if request.url.path == '/api/events' else detail)

    async def extract(_item):
        return NormalizedContest(name=detail['event']['title'], claims=[
            ClaimIn(field='start_at', value='2026-10-25T10:30:00+08:00', excerpt=EXCERPT),
            ClaimIn(field='end_at', value='2026-10-25T19:02:00+08:00', excerpt=EXCERPT),
        ])

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        original = run_pipeline(
            session_factory, client=client, sources=[('waytoagi', fetch)],
            settings=AppSettings(_env_file=None, sync_collect='structured'),
        )
        report = run_pipeline(
            session_factory, client=client, sources=[('waytoagi', fetch)],
            settings=AppSettings(_env_file=None, sync_collect='structured'),
            normalizer=LangChainNormalizer(None, invoke=extract),
        )

    assert report.failed == 0
    assert report.saved == 1
    assert report.records[0].contest_id == original.records[0].contest_id
    with session_factory() as session:
        items, total = query(session, ContestQuery())
        assert total == 1
        contest = get(session, items[0].id)

    start = contest.fields['start_at']
    end = contest.fields['end_at']
    assert (start.value, start.precision) == ('2026-10-25T02:30:00Z', 'datetime')
    assert (end.value, end.precision) == ('2026-10-25T11:02:00Z', 'datetime')
    for field in (start, end):
        assert field.level == 'official'
        assert field.sources[0].url == f'https://events.waytoagi.com/events/{event_id}'
        assert field.sources[0].excerpt == EXCERPT
    assert contest.fields['deadline_unspecified'].value == '2026-10-25T03:00:00Z'
    assert contest.fields['registration_deadline'].value is None
    assert contest.fields['submission_deadline'].value is None


@pytest.mark.parametrize(('original', 'extracted'), [
    (
        ClaimIn(field='start_at', value='2026-10-25', precision='day', excerpt='date: 2026-10-25'),
        ClaimIn(field='start_at', value='2026-10-26T10:30:00+08:00', excerpt=EXCERPT),
    ),
    (
        ClaimIn(field='start_at', value='2026-10-25T10:30:00+08:00', excerpt=EXCERPT),
        ClaimIn(field='start_at', value='2026-10-25T11:30:00+08:00', excerpt=EXCERPT),
    ),
    (
        ClaimIn(field='start_at', value='2026-10-25T10:30:00+08:00', excerpt=EXCERPT),
        ClaimIn(field='start_at', value='2026-10-25', precision='day', excerpt=EXCERPT),
    ),
    (
        ClaimIn(field='city', value='福州', excerpt='city: 福州'),
        ClaimIn(field='city', value='厦门', excerpt=EXCERPT),
    ),
    (
        ClaimIn(field='start_at', value='2026-10-25', precision='day', excerpt='date: 2026-10-25'),
        ClaimIn(field='start_at', value='2026-10-25T10:30:00+08:00', excerpt='未出现在正文的时间'),
    ),
], ids=['different-day', 'existing-time', 'precision-downgrade', 'other-field', 'missing-evidence'])
def test_normalization_keeps_existing_facts_except_supported_date_refinements(original, extracted):
    draft = ContestDraft(name='福州场', page=PageIn(
        url='https://events.waytoagi.com/events/example', site='WaytoAGI', title='福州场', is_official=True,
    ), claims=[original])
    item = NormalizationInput(draft=draft, context=EXCERPT, context_url=draft.page.url)

    normalized = merge_normalized(item, SimpleNamespace(claims=[extracted], cover_url=None, summary=None))

    assert normalized.claims == [original]


def test_date_refinement_uses_the_local_calendar_day():
    excerpt = '2026年10月25日00:30开赛'
    original = ClaimIn(field='start_at', value='2026-10-25', precision='day', excerpt='date: 2026-10-25')
    extracted = ClaimIn(field='start_at', value='2026-10-25T00:30:00+08:00', excerpt=excerpt)
    draft = ContestDraft(name='凌晨场', page=PageIn(
        url='https://events.waytoagi.com/events/overnight', site='WaytoAGI', title='凌晨场', is_official=True,
    ), claims=[original])

    normalized = merge_normalized(
        NormalizationInput(draft=draft, context=excerpt, context_url=draft.page.url),
        SimpleNamespace(claims=[extracted], cover_url=None, summary=None),
    )

    assert normalized.claims[-1].value == '2026-10-24T16:30:00Z'
    assert normalized.claims[-1].precision == 'datetime'
