import os
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, inspect, text
from sqlalchemy.orm import sessionmaker

from contest_detective.agent.rag.index import EmbeddingIndexer
from contest_detective.agent.rag.retrieval import HybridRetriever
from contest_detective.contest import service
from contest_detective.contest.content import ContestDocument
from contest_detective.contest.models import Contest
from contest_detective.contest.schemas import ClaimIn, ContestDraft, ContestQuery, PageIn
from contest_detective.framework.db import init_db

PG_URL = os.environ.get('DETECTIVE_TEST_DB_URL')
pytestmark = pytest.mark.skipif(not PG_URL, reason='DETECTIVE_TEST_DB_URL is not configured')


@pytest.fixture
def pg_factory():
    admin = create_engine(PG_URL)
    init_db(admin)
    schema = 'rag_' + uuid4().hex
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    engine = create_engine(PG_URL, connect_args={'options': f'-csearch_path={schema}'})
    init_db(engine)
    assert inspect(engine).has_table('contests', schema=schema)
    engine.dispose()
    engine = create_engine(PG_URL, connect_args={'options': f'-csearch_path={schema},public'})
    try:
        yield sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


def save(factory, name, body='帮助病人', *, contest_id=None, mode='online', deadline='2026-12-01',
         domain='organizer.example'):
    url = f'https://{domain}/{contest_id or uuid4().hex}'
    document = ContestDocument(url=url, site='organizer', title=name, is_official=True,
        body=body, content_hash=sha256(body.encode()).hexdigest(), retrieved_at='2026-10-24T00:00:00Z',
        fetch_method='http', completeness='full', extractor_version='test-v1')
    with factory() as session:
        return service.save(session, ContestDraft(name=name, summary='项目竞赛',
            documents=[document], page=PageIn(url=url, site='organizer', title=name, is_official=True),
            claims=[ClaimIn(field='mode', value=mode, excerpt=mode),
                    ClaimIn(field='submission_deadline', value=deadline, precision='day', excerpt=deadline)]),
            contest_id=contest_id)


class Embeddings:
    def __init__(self):
        self.inputs = []

    def embed(self, value):
        self.inputs.append(value)
        # Independent artificial axes exercise real pgvector distance and fusion.
        return ([1.0, 0.0] if '病人' in value else [0.0, 1.0]) + [0.0] * 1022


def test_pg_semantic_recall_merges_keyword_candidates_and_paginates(pg_factory):
    semantic = save(pg_factory, '纸飞机')
    keyword = save(pg_factory, '医疗公开赛', body='开发游戏')
    provider = Embeddings()
    assert EmbeddingIndexer(provider).refresh(pg_factory).updated == 2
    with pg_factory() as session:
        assert service.query(session, ContestQuery(keyword='医疗'))[1] == 1
        retriever = HybridRetriever(provider)
        first, total = retriever.search(session, ContestQuery(keyword='医疗', page_size=1))
        second, second_total = retriever.search(session, ContestQuery(keyword='医疗', page=2, page_size=1))
        assert total == second_total == 2
        assert {first[0].id, second[0].id} == {semantic, keyword}
        items, _ = retriever.search(session, ContestQuery(keyword='帮助病人', page_size=5))
        assert items[0].id == semantic


@pytest.mark.parametrize('query,attendable,blocked', [
    (ContestQuery(keyword='帮助病人', mode='online'), False, ()),
    (ContestQuery(keyword='帮助病人', date_from='2026-11-01T00:00:00Z'), False, ()),
    (ContestQuery(keyword='帮助病人'), True, ()),
    (ContestQuery(keyword='帮助病人'), False, ('blocked.example',)),
])
def test_pg_vector_candidates_obey_sql_filters(pg_factory, query, attendable, blocked):
    good = save(pg_factory, '纸飞机')
    save(pg_factory, '远方', mode='offline', deadline='2026-10-01', domain='sub.blocked.example')
    provider = Embeddings()
    EmbeddingIndexer(provider).refresh(pg_factory)
    with pg_factory() as session:
        items, total = HybridRetriever(provider).search(session, query, attendable=attendable, blocked_domains=blocked)
        assert [item.id for item in items] == [good] and total == 1


def test_pg_index_skips_unchanged_retries_failure_and_removes_deleted_contests(pg_factory):
    contest_id = save(pg_factory, '纸飞机')
    provider = Embeddings()
    indexer = EmbeddingIndexer(provider)
    assert indexer.refresh(pg_factory).updated == 1
    assert indexer.refresh(pg_factory).unchanged == 1
    assert len(provider.inputs) == 1
    save(pg_factory, '纸飞机', body='改变后的病人规则', contest_id=contest_id)

    class Offline:
        def embed(self, value):
            raise TimeoutError('unavailable')

    assert EmbeddingIndexer(Offline()).refresh(pg_factory).failed == 1
    with pg_factory() as session:
        assert service.get(session, contest_id).name == '纸飞机'
        assert session.scalar(text('SELECT count(*) FROM contest_embeddings')) == 1
    assert indexer.refresh(pg_factory).updated == 1
    assert indexer.refresh(pg_factory).unchanged == 1
    with pg_factory() as session:
        session.execute(delete(Contest).where(Contest.id == contest_id))
        session.commit()
        assert session.scalar(text('SELECT count(*) FROM contest_embeddings')) == 0


@pytest.mark.parametrize('failure', ['timeout', 402, 429])
def test_pg_embedding_failure_falls_back_to_keyword_results(pg_factory, failure):
    import httpx
    contest_id = save(pg_factory, '医疗公开赛')
    attempted = []

    class Offline:
        def embed(self, value):
            attempted.append(value)
            if failure == 'timeout':
                raise TimeoutError('unavailable')
            response = httpx.Response(failure, request=httpx.Request('POST', 'https://api.siliconflow.cn/v1/embeddings'))
            response.raise_for_status()

    with pg_factory() as session:
        items, total = HybridRetriever(Offline()).search(session, ContestQuery(keyword='医疗'))
        assert [item.id for item in items] == [contest_id] and total == 1
        assert attempted == ['医疗']
        # A failed vector lane must leave the SQL transaction usable.
        assert service.get(session, contest_id) is not None


def test_keyword_failure_does_not_discard_healthy_vector_results(pg_factory, monkeypatch):
    contest_id = save(pg_factory, '纸飞机')
    provider = Embeddings()
    EmbeddingIndexer(provider).refresh(pg_factory)
    original = service.candidate_query
    attempted = []

    def keyword_unavailable(session, query, **kwargs):
        if query.keyword:
            attempted.append(query.keyword)
            session.execute(text('SELECT 1 / 0'))
        return original(session, query, **kwargs)

    monkeypatch.setattr(service, 'candidate_query', keyword_unavailable)
    with pg_factory() as session:
        items, total = HybridRetriever(provider).search(session, ContestQuery(keyword='帮助病人'))
        assert [item.id for item in items] == [contest_id] and total == 1
        assert attempted == ['帮助病人']


def test_both_recall_lanes_failing_returns_an_empty_result_without_raising(pg_factory, monkeypatch):
    def unavailable(*args, **kwargs):
        raise TimeoutError('unavailable')

    class Offline:
        embed = staticmethod(unavailable)

    monkeypatch.setattr(service, 'candidate_query', unavailable)
    monkeypatch.setattr(service, 'query', unavailable)
    with pg_factory() as session:
        assert HybridRetriever(Offline()).search(session, ContestQuery(keyword='帮助病人')) == ([], 0)


def test_missing_vector_table_preserves_keyword_search_transaction(pg_factory):
    contest_id = save(pg_factory, '医疗公开赛')
    with pg_factory() as session:
        session.execute(text('DROP TABLE contest_embeddings'))
        session.commit()
        items, total = HybridRetriever(Embeddings()).search(session, ContestQuery(keyword='医疗'))
        assert [item.id for item in items] == [contest_id] and total == 1
        assert service.get(session, contest_id) is not None


def test_pg_vector_recall_preserves_explicit_history_ids_and_upper_date_filter(pg_factory):
    upcoming = save(pg_factory, '纸飞机')
    historical = save(pg_factory, '远方', deadline='2026-10-01')
    provider = Embeddings()
    EmbeddingIndexer(provider).refresh(pg_factory)
    with pg_factory() as session:
        for query, expected in [
            (ContestQuery(keyword='帮助病人', status='ended'), historical),
            (ContestQuery(keyword='帮助病人', ids=[upcoming]), upcoming),
            (ContestQuery(keyword='帮助病人', date_to='2026-10-15T00:00:00Z'), historical),
        ]:
            items, total = HybridRetriever(provider).search(session, query)
            assert [item.id for item in items] == [expected] and total == 1


@pytest.mark.parametrize('offline', [False, True])
def test_search_contests_tool_uses_hybrid_retrieval_and_preserves_briefs(pg_factory, offline):
    import asyncio
    from pydantic_ai import Agent
    from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
    from pydantic_ai.models.function import FunctionModel
    from contest_detective.agent.tools import ToolDeps, register_tools

    contest_id = save(pg_factory, '帮助病人公开赛' if offline else '纸飞机')
    provider = Embeddings()
    EmbeddingIndexer(provider).refresh(pg_factory)
    called = []

    def respond(messages, info):
        if not called:
            called.append(True)
            return ModelResponse([ToolCallPart('search_contests', {'keyword': '帮助病人', 'page_size': 5})])
        return ModelResponse([TextPart('找到候选')])

    model = FunctionModel(respond)
    class Offline:
        def embed(self, value):
            raise TimeoutError('unavailable')

    deps = ToolDeps(session_factory=pg_factory, model=model, retriever=HybridRetriever(Offline() if offline else provider))
    agent = Agent(model, deps_type=ToolDeps)
    register_tools(agent, web_enabled=False)
    result = asyncio.run(agent.run('帮助病人的比赛', deps=deps))
    output = [part.content for message in result.all_messages() for part in message.parts
              if isinstance(part, ToolReturnPart)][-1]
    assert [item['id'] for item in output['items']] == [contest_id]
    assert 'documents' not in output['items'][0] and 'fields' not in output['items'][0]
    assert deps.database_searched and deps.contest_ids == {contest_id}
    assert deps.sources == {}
    assert output['status'] == 'success' and not deps.unavailable_sources


def test_pg_index_does_not_publish_embedding_for_content_changed_during_request(pg_factory):
    contest_id = save(pg_factory, '纸飞机')

    class Changed(Embeddings):
        def embed(self, value):
            save(pg_factory, '纸飞机', body='请求期间修改的新规则', contest_id=contest_id)
            return super().embed(value)

    assert EmbeddingIndexer(Changed()).refresh(pg_factory).updated == 0
    with pg_factory() as session:
        assert session.scalar(text('SELECT count(*) FROM contest_embeddings')) == 0
