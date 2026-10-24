from datetime import datetime, timezone
from hashlib import sha256

import pytest
from pydantic import ValidationError

from contest_detective.server.contest.content import (
    ContentCitation, ContentCoverage, ContestDocument, ContestIntroduction, CoverageObservation,
)
from contest_detective.server.contest.schemas import ContestDetail, ContestDraft, ContestSummary
from contest_detective.server.research_pipeline.refresh.contracts import (
    RefreshDocument, RefreshEntry, RefreshManifest, RefreshReport, SourceInventory,
)


def document():
    body = 'A public competition for student builders.'
    return ContestDocument(url='https://example.com/event', site='Organizer', title='Event',
        is_official=True, fetch_method='http', completeness='full', body=body, content_hash=sha256(body.encode()).hexdigest(),
        retrieved_at=datetime(2026, 10, 24, tzinfo=timezone.utc), extractor_version='content-v1')


def test_content_contract_preserves_body_separately_from_intro():
    source = document()
    citation = ContentCitation(url=source.url, content_hash=source.content_hash, excerpt=source.body)
    intro = ContestIntroduction(text=source.body, citations=[citation])
    entry = RefreshEntry(key='event', name='Event', documents=[RefreshDocument(document=source)],
        introduction=intro)
    manifest = RefreshManifest(manifest_id='fixture-v1', extractor_version='content-v1',
        created_at=source.retrieved_at, scope='One public fixture', entries=[entry],
        inventory=[SourceInventory(source='fixture', termination='exhausted', discovered=1, fetched=1)])
    assert RefreshManifest.model_validate_json(manifest.model_dump_json()) == manifest
    assert manifest.entries[0].documents[0].document.body == source.body
    assert ContentCoverage().introduction.state == 'not_fetched'
    assert RefreshReport(manifest_id='fixture-v1').dry_run is True


@pytest.mark.parametrize('state', [
    'not_fetched', 'fetch_failed', 'extract_failed', 'not_found_in_source',
    'source_unpublished', 'found', 'conflict',
])
def test_collection_state_is_distinct_from_verification_level(state):
    assert CoverageObservation(state=state).state == state
    with pytest.raises(ValidationError):
        CoverageObservation(state='official')


def test_contract_rejects_unversioned_hashless_or_uncited_content():
    with pytest.raises(ValidationError):
        ContestIntroduction(text='A guess', citations=[])
    with pytest.raises(ValidationError):
        ContestDocument.model_validate(document().model_dump() | {'content_hash': 'not-a-hash'})
    with pytest.raises(ValidationError):
        ContestDocument.model_validate(document().model_dump() | {'retrieved_at': '2026-10-24T00:00:00'})
    with pytest.raises(ValidationError):
        RefreshManifest(manifest_id='fixture', extractor_version='',
            created_at=document().retrieved_at, scope='fixture')


def test_legacy_api_contracts_are_unchanged_and_do_not_advertise_skeleton():
    summary = dict(id='one', name='Legacy', cover_url=None, status='upcoming', fields={})
    assert ContestSummary(**summary).model_dump() == summary
    assert ContestDetail(**summary, summary='Unmodified full text').summary == 'Unmodified full text'
    draft = ContestDraft(name='Legacy', summary='Unmodified full text', claims=[], page={
        'url': 'https://example.com', 'site': 'Example', 'title': 'Legacy', 'is_official': False,
    })
    assert draft.summary == 'Unmodified full text'
    assert 'introduction' not in ContestSummary.model_json_schema()['properties']


def test_partial_cached_web_evidence_does_not_claim_raw_http_or_full_body():
    partial = document().model_copy(update={
        'fetch_method': 'cached_web_excerpt', 'completeness': 'partial',
        'representation': 'extracted_text',
    })
    assert partial.completeness == 'partial'
    assert partial.representation == 'extracted_text'
    assert partial.fetch_method != 'http'


def test_contract_imports_do_not_initialize_default_database_or_providers():
    import subprocess
    import sys

    code = """
import sys
from contest_detective.server.research_pipeline import detail_contracts
from contest_detective.server.research_pipeline.refresh import contracts
assert 'contest_detective.framework.db' not in sys.modules
assert 'contest_detective.server.agent.config' not in sys.modules
assert 'contest_detective.server.agent.normalization' not in sys.modules
assert 'contest_detective.server.research_pipeline.scheduler' not in sys.modules
"""
    subprocess.run([sys.executable, '-c', code], check=True)
