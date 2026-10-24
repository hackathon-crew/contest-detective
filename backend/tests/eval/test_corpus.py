"""固定快照只验证字段核实与合并，不把合成回归算成人工赛事金标。"""
import json
from pathlib import Path

import pytest

from contest_detective.server.contest import service
from contest_detective.server.contest.schemas import ContestDraft, ContestQuery

ROOT = Path(__file__).parent


def corpus():
    for path in ('public_snapshots.json', 'synthetic_regressions.json'):
        yield from json.loads((ROOT / path).read_text(encoding='utf-8'))['cases']


def test_corpus_covers_ten_public_events_with_review_boundaries():
    cases = list(corpus())
    public = [case for case in cases if case['kind'] == 'public_snapshot']
    assert len(public) >= 10
    assert any('postponed' in case['tags'] for case in public)
    assert any('deadline_types' in case['tags'] for case in public)
    for case in public:
        assert case['checked_on'] == '2026-10-24'
        assert case['human_review_status'] == 'pending'
        assert case['evidence_url'].startswith('https://')
        assert '.example' not in case['evidence_url']


@pytest.mark.parametrize('filename', ['public_snapshots.json', 'synthetic_regressions.json'])
def test_source_claims_resolve_to_the_recorded_values(session, filename):
    cases = json.loads((ROOT / filename).read_text(encoding='utf-8'))['cases']
    for case in cases:
        drafts = [ContestDraft.model_validate(item) for item in case['drafts']]
        ids = [service.save(session, draft) for draft in drafts]
        for group in case['expected_groups']:
            contest_id = ids[group['draft_indices'][0]]
            assert all(ids[index] == contest_id for index in group['draft_indices']), case['id']
            detail = service.get(session, contest_id)
            for field, expected in group['fields'].items():
                actual = detail.fields[field]
                assert (actual.value, actual.level) == tuple(expected), (case['id'], field)
                assert actual.sources, (case['id'], field)
                assert all(source.url and source.excerpt for source in actual.sources)
            for field in group.get('missing_fields', []):
                assert detail.fields[field].value is None, (case['id'], field)
                assert detail.fields[field].level == 'not_found', (case['id'], field)
            stale = {source.url for value in detail.fields.values() for source in value.sources if source.stale}
            assert stale == set(group.get('stale_urls', [])), case['id']
        assert len(set(ids)) == len(case['expected_groups']), case['id']
        assert [service.save(session, draft) for draft in drafts] == ids, case['id']
    summaries, total = service.query(session, ContestQuery(page_size=100))
    assert total == sum(len(case['expected_groups']) for case in cases)
    assert all(not value.sources for item in summaries for value in item.fields.values())
