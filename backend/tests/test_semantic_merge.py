import asyncio

import httpx
import pytest

from contest_detective.agent.normalization import LangChainNormalizer
from contest_detective.contest import service
from contest_detective.contest.content import ContentCoverage, CoverageObservation
from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.framework.config.app import AppSettings
from contest_detective.research.pipeline.execute import run_pipeline


def draft(field, values, *, url='https://events.example/event', official=False):
    return ContestDraft(name='同一场赛事', page=PageIn(url=url, site='来源', title='赛事', is_official=official),
        claims=[ClaimIn(field=field, value=value, excerpt=value) for value in values])


def normalizer(field, value, *, conflicting=False, indexes=None, fail=False):
    async def invoke(item):
        output = {'name': item.draft.name, 'claims': []}
        if getattr(item, 'merge_only', False):
            if fail:
                raise RuntimeError('model unavailable')
            output['field_merges'] = [{'field': field, 'value': value, 'conflicting': conflicting,
                'claim_indexes': [0, 1] if indexes is None else indexes,
                'reason': '同一参赛类别的人数上限分别为5人和8人' if conflicting else None}]
        return output
    return LangChainNormalizer(invoke=invoke)


def sync(session_factory, item, merge=None):
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(404))) as client:
        return run_pipeline(session_factory, client=client, sources=[('waytoagi', lambda _: [item])],
            settings=AppSettings(_env_file=None, sync_collect='structured'), normalizer=merge)


@pytest.mark.parametrize(('field', 'values', 'merged'), [
    ('team_size', ['每支团队人数上限为8人', '支持个人或团队报名，每支团队人数上限为8人。'],
     '支持个人或团队报名，每支团队人数上限为8人。'),
    ('eligibility', ['面向企业团队、高校、科研机构、开源社区及学生团队开放。支持个人或团队报名',
                     '面向企业团队、高校、科研机构、开源社区及学生团队开放。'],
     '面向企业团队、高校、科研机构、开源社区及学生团队开放。支持个人或团队报名'),
    ('prize', ['价值150w的奖金池', '价值150w的奖金池（来源未明确币种或现金占比）'],
     '价值150w的奖金池（来源未明确币种或现金占比）'),
    ('entry_requirements', ['现场可运行的Demo是交付的底线', '在ClawHunt，现场可运行的Demo是交付的底线。'],
     '现场可运行的Demo是交付的底线'),
    ('eligibility', ['面向在校学生', '允许跨校组队'], '面向在校学生，允许跨校组队'),
    ('entry_fee', ['免费', '0元'], '免费'),
])
def test_compatible_facts_merge_and_survive_database_reads(session_factory, field, values, merged):
    report = sync(session_factory, draft(field, values), normalizer(field, merged))
    assert report.saved == 1
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
        result = detail.fields[field]
        assert (result.value, result.level) == (merged, 'reposted')
        assert {source.value for source in result.sources} == set(values)
        assert all(source.url == 'https://events.example/event' and not source.stale for source in result.sources)
        assert detail.coverage.fields[field].state == 'found'
        again = service.get(session, detail.id)
        assert again.fields[field].model_dump() == result.model_dump()


def test_only_explicit_semantic_contradictions_become_conflicts(session_factory):
    report = sync(session_factory, draft('team_size', ['人数上限5人', '人数上限8人']),
                  normalizer('team_size', None, conflicting=True))
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
        assert detail.fields['team_size'].level == 'conflict'
        assert detail.fields['team_size'].value is None
        assert {source.value for source in detail.fields['team_size'].sources} == {'人数上限5人', '人数上限8人'}
        assert detail.coverage.fields['team_size'].state == 'conflict'


@pytest.mark.parametrize('merge', [None, normalizer('team_size', '每队最多8人', fail=True),
                                  normalizer('team_size', '每队最多8人', indexes=[0]),
                                  normalizer('team_size', '每队最多8人', indexes=[0, 99])])
def test_unreviewed_or_invalid_merges_keep_evidence_without_inventing_conflicts(session_factory, merge):
    report = sync(session_factory, draft('team_size', ['每队最多8人', '每队上限为8人']), merge)
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
        assert detail.fields['team_size'].level == 'not_found'
        assert detail.fields['team_size'].value is None
        assert len(detail.fields['team_size'].sources) == 2
        assert detail.coverage.fields['team_size'].state != 'conflict'


def test_changed_claims_invalidate_a_saved_merge_but_unrelated_updates_do_not(session_factory):
    report = sync(session_factory, draft('team_size', ['每队最多8人', '每队上限为8人']),
                  normalizer('team_size', '每队最多8人'))
    contest_id = report.records[0].contest_id
    with session_factory() as session:
        service.save(session, draft('venue', ['会场A'], url='https://other.example/rules'), contest_id=contest_id)
        assert service.get(session, contest_id).fields['team_size'].value == '每队最多8人'
        service.save(session, draft('team_size', ['每队最多5人'], url='https://other.example/rules'), contest_id=contest_id)
        result = service.get(session, contest_id).fields['team_size']
        assert (result.value, result.level) == (None, 'not_found')
        assert len(result.sources) == 3


def test_historical_conflict_coverage_cannot_override_current_evidence(session):
    item = draft('team_size', ['每队最多8人'])
    item.coverage = ContentCoverage(fields={'team_size': CoverageObservation(state='conflict')})
    contest_id = service.save(session, item)
    detail = service.get(session, contest_id)
    assert detail.fields['team_size'].level == 'reposted'
    assert detail.coverage.fields['team_size'].state == 'found'


def test_history_and_new_source_are_merged_together_without_losing_provenance(session_factory):
    with session_factory() as session:
        contest_id = service.save(session, draft('eligibility', ['面向在校学生'], official=True))
    incoming = draft('eligibility', ['允许跨校组队'], url='https://news.example/rules')
    from contest_detective.research.pipeline.models import ContestSyncContext, ContestSyncInput
    from contest_detective.research.pipeline.persist import persist
    from contest_detective.research.pipeline.stages import DraftVerify
    ctx = ContestSyncContext(request=ContestSyncInput(name=incoming.name), extracted_items=[incoming],
        contest_by_url={incoming.page.url: contest_id})
    stage = DraftVerify(session_factory, normalizer=normalizer('eligibility', '面向在校学生，允许跨校组队'))
    asyncio.run(stage.run(ctx))
    persist(session_factory, ctx)
    with session_factory() as session:
        result = service.get(session, contest_id).fields['eligibility']
        assert (result.value, result.level) == ('面向在校学生，允许跨校组队', 'reposted')
        assert {source.url for source in result.sources} == {'https://events.example/event', 'https://news.example/rules'}
        assert not any(source.stale for source in result.sources)


def test_one_merge_request_handles_all_changed_fields_and_unchanged_sources_reuse_it(session_factory):
    calls = []
    item = draft('team_size', ['最多8人', '人数上限8人'])
    item.claims.extend([ClaimIn(field='entry_fee', value='免费', excerpt='免费'),
                        ClaimIn(field='entry_fee', value='0元', excerpt='0元')])

    async def invoke(request):
        output = {'name': item.name, 'claims': []}
        if request.merge_only:
            calls.append(request)
            output['field_merges'] = [
                {'field': 'entry_fee', 'value': '免费', 'claim_indexes': [0, 1]},
                {'field': 'team_size', 'value': '最多8人', 'claim_indexes': [2, 3]},
            ]
        return output

    model = LangChainNormalizer(invoke=invoke)
    first = sync(session_factory, item, model)
    second = sync(session_factory, item, model)
    assert len(calls) == 1
    assert first.records[0].contest_id == second.records[0].contest_id
    with session_factory() as session:
        detail = service.get(session, first.records[0].contest_id)
        assert detail.fields['entry_fee'].value == '免费'
        assert detail.fields['team_size'].value == '最多8人'


def test_cross_field_merge_references_are_not_accepted(session_factory):
    item = draft('team_size', ['最多8人', '人数上限8人'])
    item.claims.extend([ClaimIn(field='entry_fee', value='免费', excerpt='免费'),
                        ClaimIn(field='entry_fee', value='0元', excerpt='0元')])
    report = sync(session_factory, item, normalizer('team_size', '最多8人', indexes=[0, 1]))
    with session_factory() as session:
        detail = service.get(session, report.records[0].contest_id)
        assert detail.fields['team_size'].value is None
        assert detail.fields['team_size'].level == 'not_found'
        assert len(detail.fields['entry_fee'].sources) == 2


def test_page_refresh_merges_new_facts_with_historical_sources(session_factory):
    from contest_detective.research.record import run
    with session_factory() as session:
        contest_id = service.save(session, draft('eligibility', ['面向在校学生']))

    async def extract(url, text):
        return draft('eligibility', ['允许跨校组队'], url=url)

    asyncio.run(run('https://organizer.example/rules', extractor=extract, page_text='允许跨校组队',
        contest_id=contest_id, session_factory=session_factory,
        normalizer=normalizer('eligibility', '面向在校学生，允许跨校组队')))
    with session_factory() as session:
        result = service.get(session, contest_id).fields['eligibility']
        assert result.value == '面向在校学生，允许跨校组队'
        assert {source.value for source in result.sources} == {'面向在校学生', '允许跨校组队'}


def test_historical_candidate_scan_does_not_call_models_or_run_migrations(session_factory, monkeypatch, capsys):
    import json
    import sys
    from contest_detective.bootstrap import source_sync
    with session_factory() as session:
        service.save(session, draft('team_size', ['最多8人', '人数上限8人']))
    monkeypatch.setattr(source_sync, 'SessionLocal', session_factory)
    monkeypatch.setattr(source_sync, 'init_db', lambda: pytest.fail('candidate scan must not run migrations'))
    monkeypatch.setattr(source_sync, 'configured_normalizer', lambda: pytest.fail('candidate scan must not construct models'))
    monkeypatch.setattr(sys, 'argv', ['contest-detective-sync', '--reconcile-existing'])
    source_sync.main()
    report = json.loads(capsys.readouterr().out)
    assert report['candidates'] == 1
    assert report['maximum_model_requests'] == 1
    assert report['applied'] == 0
    assert report['fields'] == {'team_size': 1}


def test_explicit_historical_reconciliation_changes_only_derived_results(session_factory, monkeypatch, capsys):
    import json
    import sys
    from sqlalchemy import select
    from contest_detective.bootstrap import source_sync
    from contest_detective.contest.models import ContestClaim, ContestPageLink
    with session_factory() as session:
        contest_id = service.save(session, draft('team_size', ['最多8人', '人数上限8人']))
        before = [(row.page_id, row.field, row.value, row.excerpt) for row in session.scalars(select(ContestClaim))]
        revision = session.scalars(select(ContestPageLink)).one().revision
    monkeypatch.setattr(source_sync, 'SessionLocal', session_factory)
    monkeypatch.setattr(source_sync, 'configured_normalizer', lambda: normalizer('team_size', '最多8人'))
    monkeypatch.setattr(source_sync, 'init_db', lambda: pytest.fail('reconciliation must not run migrations'))
    monkeypatch.setattr(source_sync, 'run_pipeline', lambda *args, **kwargs: pytest.fail('reconciliation must not run a full source sync'))
    monkeypatch.setattr(sys, 'argv', ['contest-detective-sync', '--reconcile-existing', '--apply'])
    source_sync.main()
    report = json.loads(capsys.readouterr().out)
    assert report['applied'] == 1
    with session_factory() as session:
        result = service.get(session, contest_id).fields['team_size']
        assert (result.value, result.level) == ('最多8人', 'reposted')
        assert [(row.page_id, row.field, row.value, row.excerpt) for row in session.scalars(select(ContestClaim))] == before
        assert session.scalars(select(ContestPageLink)).one().revision == revision
