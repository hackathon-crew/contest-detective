"""Refresh committed contests independently of ingestion transactions."""
import logging

from sqlalchemy import select

from contest_detective.contest.models import Contest, ContestDetails
from .contracts import IndexReport
from .documents import build_document
from .provider import configured_provider
from . import store

logger = logging.getLogger(__name__)


class EmbeddingIndexer:
    def __init__(self, provider=None):
        self.provider = provider

    def refresh(self, session_factory) -> IndexReport:
        report = IndexReport()
        with session_factory() as session:
            if session.get_bind().dialect.name != 'postgresql':
                return report
            provider = self.provider or configured_provider()
            if provider is None:
                return report
            documents = [build_document(contest, details) for contest, details in session.execute(
                select(Contest, ContestDetails).join(ContestDetails)).all()]
            previous = dict(session.execute(select(store.embeddings.c.contest_id, store.embeddings.c.content_hash)).all())
        for document in documents:
            if previous.get(document.contest_id) == document.content_hash:
                report.unchanged += 1
                continue
            try:
                vector = provider.embed(document.text)
                with session_factory() as session:
                    contest = session.get(Contest, document.contest_id, with_for_update=True)
                    details = session.get(ContestDetails, document.contest_id)
                    if contest is None or details is None:
                        continue
                    if build_document(contest, details).content_hash != document.content_hash:
                        report.failed += 1
                        continue
                    store.put(session, document, vector)
                    session.commit()
                report.updated += 1
            except Exception as error:
                report.failed += 1
                logger.warning('Contest embedding failed contest_id=%s error_type=%s',
                               document.contest_id, type(error).__name__, exc_info=True)
        return report


def refresh_index(session_factory) -> IndexReport:
    """A failed index must never turn a committed source sync into a failure."""
    try:
        report = EmbeddingIndexer().refresh(session_factory)
        logger.info('Contest index updated=%s unchanged=%s failed=%s', report.updated, report.unchanged, report.failed)
        return report
    except Exception as error:
        logger.warning('Contest index unavailable error_type=%s', type(error).__name__, exc_info=True)
        return IndexReport(failed=1)
