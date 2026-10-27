"""Persist each contest atomically; one bad record cannot discard healthy records."""

import logging

from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.contest.service import save
from contest_detective.research.refresh.contracts import RefreshFailure

logger = logging.getLogger(__name__)


def persist(session_factory, ctx) -> int:
    counts = ctx.stage_counts.setdefault('persist', {})
    successful = []
    for record in ctx.records:
        counts['attempted'] = counts.get('attempted', 0) + 1
        contest_id = record.contest_id
        pages: dict[str, tuple[PageIn, list[ClaimIn]]] = {}
        for field, value in record.fields.items():
            for source in value.sources:
                page = PageIn(url=source.url, site=source.site, title=source.title or record.name,
                              published_at=source.published_at, is_official=source.is_official)
                pages.setdefault(source.url, (page, []))[1].append(ClaimIn(
                    field=field, value=source.value, excerpt=source.excerpt, precision=source.precision))
        # A readable body/intro is worth saving even if there are no extracted fact claims.
        for document in record.documents:
            page = PageIn(**{key: getattr(document, key) for key in PageIn.model_fields})
            previous = pages.get(document.url)
            pages[document.url] = (page, previous[1] if previous else [])
        if not pages:
            ctx.skipped += 1
            counts['skipped'] = counts.get('skipped', 0) + 1
            continue
        try:
            with session_factory() as session:
                for page, claims in pages.values():
                    # Theme labels originate in Devpost listing data, not arbitrary merged pages.
                    themes = record.theme_pages.get(page.url)
                    draft = ContestDraft(name=record.name, cover_url=record.cover_url, summary=record.summary,
                        introduction=record.introduction, documents=record.documents,
                        coverage=record.coverage, themes=themes, page=page, claims=claims)
                    contest_id = save(session, draft, contest_id=contest_id, commit=False)
                session.commit()
        except Exception as error:
            ctx.failed += 1
            counts['failed'] = counts.get('failed', 0) + 1
            ctx.failures.append(RefreshFailure(key=record.name, stage='persist',
                reason=f'Atomic contest persistence failed ({type(error).__name__})', retryable=False))
            logger.warning('Contest persistence failed error_type=%s', type(error).__name__)
            continue
        record.contest_id = contest_id
        successful.append(record)
        counts['saved'] = counts.get('saved', 0) + 1
        counts['saved_pages'] = counts.get('saved_pages', 0) + len(pages)
    ctx.records = successful
    return len({record.contest_id for record in successful})
