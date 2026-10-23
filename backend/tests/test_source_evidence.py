import json
from importlib import import_module
from pathlib import Path

import httpx
import pytest

from contest_detective.server.contest import service as contests

FIXTURES = Path(__file__).parent / 'fixtures'
CASES = [
    ('hackertrip', 'venue', '重庆来福士', 'venue: 重庆来福士', 'reposted'),
    ('waytoagi', 'venue', '北京亦庄通明湖会议中心', 'venue: 北京亦庄通明湖会议中心', 'reposted'),
    ('devpost', 'eligibility', 'On-campus Cornell SYSEN MEng/MS + SYSEN 5300, 5900',
     'eligibility_requirement_invite_only_description: On-campus Cornell SYSEN MEng/MS + SYSEN 5300, 5900', 'official'),
]


def load(name):
    return json.loads((FIXTURES / name).read_text())


def replay(source, *, empty=False, raw=None):
    payload = load(f'{source}.json')
    details = load('waytoagi_details.json') if source == 'waytoagi' else None
    if empty:
        if source == 'hackertrip':
            for event in payload:
                event['venue'] = raw
        elif source == 'waytoagi':
            for event in payload['items']:
                event['venue'] = raw
            for detail in details.values():
                detail['event']['venue'] = raw
        else:
            for page in payload.values():
                for event in page['hackathons']:
                    event['eligibility_requirement_invite_only_description'] = raw

    def handle(request):
        if source == 'devpost':
            return httpx.Response(200, json=payload[request.url.params['page']])
        if source == 'waytoagi' and request.url.path != '/api/events':
            return httpx.Response(200, json=details[request.url.path.rsplit('/', 1)[-1]])
        return httpx.Response(200, json=payload)

    adapter = import_module(f'contest_detective.server.research_pipeline.sources.{source}')
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        return adapter.fetch(client)


@pytest.mark.parametrize(('source', 'field', 'value', 'excerpt', 'level'), CASES)
def test_structured_participation_evidence_keeps_real_source_and_verification_level(session, source, field, value, excerpt, level):
    drafts = replay(source)
    draft = next(draft for draft in drafts if any(claim.field == field and claim.value == value for claim in draft.claims))
    contest_id = contests.save(session, draft)
    evidence = contests.get(session, contest_id).fields[field]
    assert evidence.value == value and evidence.level == level
    assert len(evidence.sources) == 1
    assert evidence.sources[0].url == draft.page.url
    assert evidence.sources[0].excerpt == excerpt
    unsupported = {'team_size', 'entry_fee', 'entry_requirements', 'judging_criteria', 'past_statistics'}
    assert not any(claim.field in unsupported for draft in drafts for claim in draft.claims)


@pytest.mark.parametrize(('source', 'field'), [(source, field) for source, field, *_ in CASES])
@pytest.mark.parametrize('raw', [None, '   '])
def test_missing_or_blank_structured_fields_do_not_create_claims(source, field, raw):
    assert not any(claim.field == field for draft in replay(source, empty=True, raw=raw) for claim in draft.claims)
