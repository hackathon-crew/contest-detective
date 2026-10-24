from datetime import datetime, timezone
from hashlib import sha256

import pytest

from contest_detective.server.contest.content import ContestDocument, ContestIntroduction, ContentCitation
from contest_detective.server.contest.content_service import (
    build_introduction, public_document, validate_document, validate_introduction, validate_public_url,
)


def document(body, **changes):
    return ContestDocument(url='https://organizer.example/event', site='Organizer', title='Builder event',
        is_official=True, body=body, content_hash=sha256(body.encode()).hexdigest(),
        retrieved_at=datetime(2026, 10, 24, tzinfo=timezone.utc), extractor_version='content-v1',
        fetch_method='http', completeness='full', **changes)


@pytest.mark.parametrize('url', ['http://localhost/event', 'http://127.0.0.1/event', 'http://127.1/event',
    'http://2130706433/event', 'http://0x7f000001/event', 'http://intranet/event', 'http://router.lan/',
    'http://[::1]/', 'file:///tmp/body', 'https://user:password@organizer.example/event'])
def test_public_evidence_rejects_private_or_credential_bearing_urls(url):
    with pytest.raises(ValueError):
        validate_public_url(url)


def test_extracts_only_genuine_readable_body_without_losing_original():
    body = '# Builder Weekend\n\nStudent developers collaborate to build useful projects for their communities.\n\nRules apply.'
    doc = document(body)
    intro = build_introduction(doc)
    assert intro.text == 'Student developers collaborate to build useful projects for their communities.'
    validate_introduction(intro, [doc])
    assert doc.body == body
    assert public_document(doc, [intro.text]).body is None
    for stub in ('AI、Education\n\n提交区间：Oct 1 - 3, 2026', '# Hackathon title', 'Log in to build your developer account and accept privacy policy.'):
        assert build_introduction(document(stub)) is None


def test_extractive_cjk_sentence_join_keeps_literal_evidence():
    body = '欢迎开发者一起构建真实可用的作品。比赛面向愿意学习和合作的开发者。'
    doc = document(body)
    intro = ContestIntroduction(text=body, citations=[ContentCitation(url=doc.url,
        content_hash=doc.content_hash, excerpt=part+'。') for part in body.split('。') if part])
    validate_introduction(intro, [doc])
    intro.text = intro.text.replace('开发者', '投资者')
    with pytest.raises(ValueError, match='preserve'):
        validate_introduction(intro, [doc])


def test_full_text_publication_needs_an_explicit_license_and_snippets_are_partial():
    doc = document('Student developers collaborate to build useful public projects.')
    doc.publication = 'full_text_allowed'
    with pytest.raises(ValueError, match='license'):
        validate_document(doc)
    doc.publication_license_url = 'https://organizer.example/license'
    validate_document(doc)
    assert public_document(doc, []).body == doc.body
    doc.kind = 'search_snippet'
    with pytest.raises(ValueError, match='complete'):
        validate_document(doc)


def test_partial_or_new_version_capture_does_not_replace_complete_evidence(session_factory):
    from contest_detective.server.contest import service
    from contest_detective.server.contest.schemas import ContestDraft, PageIn
    doc = document('Student developers collaborate to build useful projects for the community.')
    draft = ContestDraft(name='Builder event', page=PageIn(url=doc.url, site=doc.site,
        title=doc.title, is_official=True), documents=[doc], claims=[])
    with session_factory() as session:
        cid = service.save(session, draft)
        partial = doc.model_copy(update={'kind': 'search_snippet', 'completeness': 'partial'})
        service.save(session, draft.model_copy(update={'documents':[partial]}), contest_id=cid)
        revised = doc.model_copy(update={'extractor_version':'content-v2'})
        service.save(session, draft.model_copy(update={'documents':[revised]}), contest_id=cid)
        result = service.get(session, cid)
        assert len(result.documents) == 3
        assert {(item.kind, item.completeness, item.extractor_version) for item in result.documents} == {
            ('page', 'full', 'content-v1'), ('search_snippet', 'partial', 'content-v1'), ('page', 'full', 'content-v2')}
        assert result.introduction.text == doc.body
