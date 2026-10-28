import json
from types import SimpleNamespace

import httpx
import pytest

from contest_detective.agent.rag.documents import build_document
from contest_detective.agent.rag.provider import SiliconFlowEmbedding
from contest_detective.agent.rag.retrieval import HybridRetriever, merge_ranks
from contest_detective.contest import service
from contest_detective.contest.models import Contest, ContestDetails
from contest_detective.contest.schemas import ContestDraft, ContestQuery, PageIn


def test_embedding_uses_free_model_and_validates_response():
    def respond(request):
        assert request.url == 'https://api.siliconflow.cn/v1/embeddings'
        assert request.headers['Authorization'] == 'Bearer test-only'
        assert json.loads(request.content) == {
            'model': 'BAAI/bge-m3', 'input': '帮助病人的工具', 'encoding_format': 'float',
        }
        return httpx.Response(200, json={'data': [{'index': 0, 'embedding': [1.0] + [0.0] * 1023}]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = SiliconFlowEmbedding('test-only', client=client).embed('帮助病人的工具')
    assert len(result) == 1024 and result[0] == 1.0


@pytest.mark.parametrize('vector', [[], [1.0] * 12, [0.0] * 1024, [float('nan')] * 1024])
def test_embedding_rejects_unusable_vectors(vector):
    # Mock only the external response; validation is the actual production boundary.
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={
        'data': [{'index': 0, 'embedding': vector}],
    }) if not any(str(v) == 'nan' for v in vector) else httpx.Response(
        200, content='{"data":[{"index":0,"embedding":[' + ','.join(['NaN'] * 1024) + ']}]}'))
    with httpx.Client(transport=transport) as client:
        with pytest.raises(ValueError):
            SiliconFlowEmbedding('test-only', client=client).embed('比赛')


def test_document_hash_ignores_fetch_metadata_but_tracks_semantic_changes():
    contest = Contest(id='one', name='纸飞机')
    details = ContestDetails(summary='改善诊疗体验', themes=['Health'], fields={
        'eligibility': {'value': '本科生', 'sources': [{'url': 'https://example.org'}]},
    }, documents=[{'url': 'https://example.org', 'kind': 'page', 'body': '帮助癌症患者',
                   'retrieved_at': '2026-10-01', 'content_hash': 'old'}])
    first = build_document(contest, details)
    assert all(value in first.text for value in ('纸飞机', '改善诊疗体验', 'Health', '本科生', '帮助癌症患者'))
    details.documents[0].update(retrieved_at='2026-10-28', content_hash='new')
    details.fields['eligibility']['sources'][0]['url'] = 'https://another.example.org'
    assert build_document(contest, details).content_hash == first.content_hash
    details.documents[0]['body'] = '帮助农村病人'
    assert build_document(contest, details).content_hash != first.content_hash


def test_document_is_single_bounded_input_and_ignores_search_snippets():
    contest = Contest(id='one', name='纸飞机')
    details = ContestDetails(summary='简介', themes=[], fields={}, documents=[
        {'url': 'https://example.org/snippet', 'kind': 'search_snippet', 'body': '未经打开的线索'},
        {'url': 'https://example.org/rules', 'kind': 'page', 'body': '规则正文' * 10000},
    ])
    document = build_document(contest, details)
    assert len(document.text.encode('utf-8')) <= 8000
    assert '未经打开的线索' not in document.text
    assert document.text.startswith('纸飞机')


def test_rank_fusion_deduplicates_and_keeps_both_lanes():
    assert merge_ranks(['keyword', 'both'], ['both', 'semantic']) == ['both', 'keyword', 'semantic']


def test_sqlite_keeps_keyword_search_without_embedding_requests(session):
    contest_id = service.save(session, ContestDraft(name='纸飞机', summary='医疗工具',
        page=PageIn(url='https://example.org/rules', site='organizer', title='规则', is_official=True), claims=[]))

    def forbidden(_):
        pytest.fail('SQLite must not call the embedding model')

    retriever = HybridRetriever(SimpleNamespace(embed=forbidden))
    items, total = retriever.search(session, ContestQuery(keyword='医疗'))
    assert [item.id for item in items] == [contest_id] and total == 1
    assert retriever.search(session, ContestQuery(keyword='帮助病人')) == ([], 0)


def test_sqlite_does_not_create_or_refresh_a_vector_table(session_factory):
    from sqlalchemy import inspect
    from contest_detective.agent.rag.index import EmbeddingIndexer

    def forbidden(_):
        pytest.fail('SQLite must not call the embedding model')

    assert not inspect(session_factory.kw['bind']).has_table('contest_embeddings')
    report = EmbeddingIndexer(SimpleNamespace(embed=forbidden)).refresh(session_factory)
    assert report.updated == report.failed == 0
