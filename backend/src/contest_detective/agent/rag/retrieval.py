"""Keyword plus dense recall, with deterministic rank fusion and existing filters."""
import logging

from contest_detective.contest import service as contests
from .provider import configured_provider
from . import store

logger = logging.getLogger(__name__)


def merge_ranks(*lanes):
    scores = {}
    order = {}
    for lane in lanes:
        for rank, contest_id in enumerate(dict.fromkeys(lane), start=1):
            order.setdefault(contest_id, len(order))
            scores[contest_id] = scores.get(contest_id, 0) + 1 / (60 + rank)
    return sorted(scores, key=lambda item: (-scores[item], order[item]))


class HybridRetriever:
    def __init__(self, provider=None):
        self.provider = provider
        self._vectors = {}

    def search(self, session, query, *, attendable=False, blocked_domains=(), recall_limit=None, **filters):
        options = {'attendable': attendable, 'blocked_domains': blocked_domains, **filters}
        if not query.keyword or not query.keyword.strip() or session.get_bind().dialect.name != 'postgresql':
            try:
                with session.begin_nested():
                    return contests.query(session, query, **options)
            except Exception as error:
                logger.warning('Keyword retrieval unavailable error_type=%s', type(error).__name__, exc_info=True)
                return [], 0

        keywords, semantic = [], []
        # Keyword recall runs for every search, independently of the model lane.
        try:
            with session.begin_nested():
                statement = contests.candidate_query(session, query, **options)
                keywords = list(session.scalars(statement.limit(recall_limit) if recall_limit else statement))
        except Exception as error:
            logger.warning('Keyword retrieval unavailable error_type=%s', type(error).__name__, exc_info=True)

        try:
            provider = self.provider or configured_provider()
            if provider is not None:
                text = query.keyword.strip()
                if recall_limit is None:
                    vector = provider.embed(text)
                else:
                    if text not in self._vectors:
                        self._vectors[text] = provider.embed(text)
                    vector = self._vectors[text]
                # A broken lane rolls back only its own SQL savepoint.
                with session.begin_nested():
                    eligible = contests.candidate_query(session, query.model_copy(update={'keyword': None}), **options)
                    semantic = store.nearest(session, eligible, vector, **({'limit': recall_limit} if recall_limit else {}))
        except Exception as error:
            logger.warning('Semantic retrieval unavailable error_type=%s', type(error).__name__, exc_info=True)

        ranked = merge_ranks(keywords, semantic)
        offset = (query.page - 1) * query.page_size
        ids = ranked[offset:offset + query.page_size]
        if not ids:
            return [], len(ranked)
        try:
            with session.begin_nested():
                items, _ = contests.query(session, query.model_copy(update={
                    'keyword': None, 'ids': ids, 'page': 1, 'page_size': query.page_size,
                }), **options)
            by_id = {item.id: item for item in items}
            return [by_id[contest_id] for contest_id in ids if contest_id in by_id], len(ranked)
        except Exception as error:
            logger.warning('Contest candidates unavailable error_type=%s', type(error).__name__, exc_info=True)
            return [], 0
