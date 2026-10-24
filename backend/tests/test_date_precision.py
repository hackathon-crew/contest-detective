import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest
import httpx
from alembic import command
from alembic.config import Config
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import MetaData, create_engine, select

from contest_detective.framework import db
from contest_detective.server.agent.extraction import create_page_extractor
from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, ContestQuery, Source
from contest_detective.server.contest.verification import resolve


def draft(*claims, url='https://calendar.devpost.com/', official=True):
    return ContestDraft(name='日期粒度赛事', page={
        'url': url, 'site': '活动官网', 'title': '赛程', 'is_official': official,
    }, claims=list(claims))


def claim(field, value, precision='day'):
    return {'field': field, 'value': value, 'precision': precision, 'excerpt': f'{field}: {value}'}


def test_day_claim_is_an_anchor_for_the_literal_calendar_date():
    value = ClaimIn(**claim('start_at', '2026-10-27'))
    assert value.value == '2026-10-27T00:00:00Z'
    assert value.precision == 'day'
    assert ClaimIn(**claim('start_at', '2026-10-27T00:00:00+08:00')).value == value.value
    exact = ClaimIn(field='start_at', value='2026-10-27T08:30:00+08:00', excerpt='早上8:30')
    assert (exact.value, exact.precision) == ('2026-10-27T00:30:00Z', 'datetime')
    with pytest.raises(ValidationError):
        ClaimIn(field='start_at', value='2026-10-27', excerpt='10月27日')


def test_saved_list_and_detail_preserve_day_precision(session, client):
    contest_id = service.save(session, draft(claim('submission_deadline', '2026-10-27')))
    item = service.query(session, ContestQuery(ids=[contest_id]))[0][0]
    assert item.fields['submission_deadline'].precision == 'day'
    evidence = client.get(f'/contests/{contest_id}').json()['data']['fields']['submission_deadline']
    assert evidence['value'] == '2026-10-27T00:00:00Z'
    assert evidence['precision'] == evidence['sources'][0]['precision'] == 'day'
    assert evidence['sources'][0]['excerpt'] == 'submission_deadline: 2026-10-27'


@pytest.mark.parametrize('clock,expected', [
    ('2026-10-27T00:30:00Z', 'upcoming'),
    ('2026-10-27T15:59:59Z', 'upcoming'),
    ('2026-10-27T16:00:00Z', 'ended'),
])
def test_day_deadline_stays_available_through_the_beijing_calendar_day(session, monkeypatch, clock, expected):
    now = datetime.fromisoformat(clock)
    monkeypatch.setattr(service, '_now', lambda: now)
    contest_id = service.save(session, draft(claim('submission_deadline', '2026-10-27')))
    assert service.get(session, contest_id).status == expected
    matching = service.query(session, ContestQuery(status=expected))[0]
    assert [item.id for item in matching] == [contest_id]
    deadline = service._next_deadline(matching[0].fields, now)
    assert deadline == ('2026-10-27T00:00:00Z' if expected == 'upcoming' else None)


def test_day_filter_matches_calendar_day_and_start_end_do_not_expire_at_anchor(session, monkeypatch):
    monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 27, 15, tzinfo=timezone.utc))
    contest_id = service.save(session, draft(claim('start_at', '2026-10-27'), claim('end_at', '2026-10-28')))
    assert service.get(session, contest_id).status == 'ongoing'
    items, total = service.query(session, ContestQuery(
        date_from='2026-10-27T12:00:00+08:00', date_to='2026-10-27T18:00:00+08:00'))
    assert total == 1 and items[0].id == contest_id
    monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 28, 15, 59, tzinfo=timezone.utc))
    assert service.get(session, contest_id).status == 'ongoing'
    monkeypatch.setattr(service, '_now', lambda: datetime(2026, 10, 28, 16, tzinfo=timezone.utc))
    assert service.get(session, contest_id).status == 'ended'


def source(value, precision, official, published='2026-10-20T00:00:00Z', url='https://organizer.example/schedule'):
    return Source(url=url, site='来源', title='赛程', is_official=official,
                  value=value, precision=precision, excerpt=value, published_at=published)


@pytest.mark.parametrize('official', [True, False])
def test_same_day_exact_time_refines_a_day_without_false_conflict(official):
    day = source('2026-10-27T00:00:00Z', 'day', official, published='2026-10-23T00:00:00Z')
    exact = source('2026-10-26T23:30:00Z', 'datetime', official)
    value = resolve('start_at', [day, exact])
    assert (value.value, value.precision) == (exact.value, 'datetime')
    assert value.level == ('official' if official else 'reposted')
    assert len(value.sources) == 2 and not any(item.stale for item in value.sources)


def test_reposted_exact_time_cannot_refine_an_official_date_and_real_conflicts_remain():
    day = source('2026-10-27T00:00:00Z', 'day', True)
    repost = source('2026-10-27T01:00:00Z', 'datetime', False, url='https://news.example/schedule')
    assert resolve('start_at', [day, repost]).precision == 'day'
    assert not resolve('start_at', [day, repost]).sources[1].stale
    other = source('2026-10-28T00:00:00Z', 'day', False)
    assert resolve('start_at', [repost, other]).level == 'conflict'
    different_hour = source('2026-10-27T02:00:00Z', 'datetime', False)
    assert resolve('start_at', [repost, different_hour]).level == 'conflict'


def test_day_start_merges_with_exact_time_on_the_same_beijing_date(session):
    first = service.save(session, draft(claim('start_at', '2026-10-27')))
    exact = draft(claim('start_at', '2026-10-26T23:30:00Z', 'datetime'), url='https://organizer.example/start')
    assert service.save(session, exact) == first


def test_extraction_instructions_and_output_preserve_day_precision():
    def respond(_, info):
        assert 'precision=day' in info.instructions and '不填小时' in info.instructions
        return ModelResponse([ToolCallPart(info.output_tools[0].name,
            draft(claim('start_at', '2026-10-27')).model_dump(mode='json'))])
    extracted = asyncio.run(create_page_extractor(model=FunctionModel(respond))(
        'https://calendar.devpost.com/', '活动日期2026-10-27，具体时间另行通知'))
    assert (extracted.claims[0].value, extracted.claims[0].precision) == ('2026-10-27T00:00:00Z', 'day')


def test_structured_adapters_preserve_date_only_without_downgrading_exact_deadlines():
    from contest_detective.server.research_pipeline.sources import devpost, waytoagi
    event = {'id': 'one', 'title': '日期活动', 'eventKind': 'hackathon', 'timeStatus': 'upcoming',
             'date': '2026-10-27', 'endDate': '2026-10-28', 'deadline': '2026-10-26T23:59'}
    def handle(request):
        if request.url.host == 'devpost.com':
            return httpx.Response(200, json={'hackathons': [{'title': '日期活动', 'url': 'https://dates.devpost.com/',
                'open_state': 'open', 'submission_period_dates': 'Oct 01 - 27, 2026'}] if request.url.params['page'] == '1' else []})
        return httpx.Response(200, json={'ok': True, 'items': [event]} if request.url.path == '/api/events' else {'event': event})
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        dev, = devpost.fetch(client)
        way, = waytoagi.fetch(client)
    dev_dates = {item.field: item for item in dev.claims}
    assert (dev_dates['submission_deadline'].value, dev_dates['submission_deadline'].precision) == ('2026-10-27T00:00:00Z', 'day')
    way_dates = {item.field: item for item in way.claims}
    assert (way_dates['start_at'].value, way_dates['start_at'].precision) == ('2026-10-27T00:00:00Z', 'day')
    assert (way_dates['end_at'].value, way_dates['end_at'].precision) == ('2026-10-28T00:00:00Z', 'day')
    assert (way_dates['deadline_unspecified'].value, way_dates['deadline_unspecified'].precision) == ('2026-10-26T15:59:00Z', 'datetime')


def test_legacy_migration_backfills_only_known_date_only_source_fields(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "legacy.db"}')
    config = Config()
    config.set_main_option('script_location', str(Path(db.__file__).parent / 'migrations'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, '0006_investigations')
        metadata = MetaData()
        metadata.reflect(connection)
        contests, pages, claims = [metadata.tables[name] for name in ['contests', 'contest_pages', 'contest_claims']]
        for name, site, url, field, old, excerpt in [
            ('devpost', 'Devpost', 'https://legacy.devpost.com/', 'submission_deadline', '2026-10-27T00:00:00Z', 'submission_period_dates: Oct 01 - 27, 2026'),
            ('wayto', 'WaytoAGI', 'https://events.waytoagi.com/events/old', 'start_at', '2026-10-26T16:00:00Z', 'date: 2026-10-27'),
            ('exact', 'WaytoAGI', 'https://events.waytoagi.com/events/precise', 'deadline_unspecified', '2026-10-27T15:59:00Z', 'deadline: 2026-10-27T23:59:00+08:00'),
            ('hackertrip', 'HackerTrip', 'https://hackertrip.space/hackathon/old', 'start_at', '2026-10-27T00:00:00Z', 'start_at: 2026-10-27T00:00:00Z'),
        ]:
            connection.execute(contests.insert().values(id=name, name=name, normalized_name=name,
                start_at=old if field == 'start_at' else None, fields={field: {'value': old, 'level': 'official'}}))
            connection.execute(pages.insert().values(id=name, url=url, site=site, title=name, is_official=True))
            connection.execute(claims.insert().values(contest_id=name, page_id=name, field=field, value=old, excerpt=excerpt))
        command.upgrade(config, 'head')
        fresh = MetaData()
        fresh.reflect(connection)
        stored = connection.execute(select(fresh.tables['contest_claims'])).mappings().all()
        values = {row['contest_id']: row for row in stored}
        assert values['devpost']['precision'] == values['wayto']['precision'] == 'day'
        assert values['wayto']['value'] == '2026-10-27T00:00:00Z'
        assert values['exact']['precision'] == values['hackertrip']['precision'] == 'datetime'
        materialized = {row['id']: row for row in connection.execute(select(fresh.tables['contests'])).mappings()}
        assert materialized['devpost']['fields']['submission_deadline']['precision'] == 'day'
        assert materialized['wayto']['start_at'] == '2026-10-27T00:00:00Z'
        assert materialized['wayto']['start_date'] == '2026-10-27'
    engine.dispose()
