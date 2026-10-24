"""结构化来源的上下文补全、确定性去重和候选合并。"""

from dataclasses import dataclass, field
import asyncio
from urllib.parse import urlsplit

from contest_detective.server.contest.identity import can_merge, normalized_url
from contest_detective.server.contest.schemas import ContestDraft, PageIn
from contest_detective.server.research_pipeline.search.base import SearchHit


@dataclass
class StructuredCandidate:
    source: str
    draft: ContestDraft
    context: str = ''
    context_url: str | None = None
    group: list['StructuredCandidate'] = field(default_factory=list)
    claim_pages: dict[int, PageIn] = field(default_factory=dict)

    def __post_init__(self):
        self.context = (self.draft.summary or '').strip()
        self.claim_pages.update({id(claim): self.draft.page for claim in self.draft.claims})

    @property
    def has_description(self) -> bool:
        return self.source in {'hackertrip', 'waytoagi'} and bool(self.draft.summary and self.draft.summary.strip())

    @property
    def needs_enrichment(self) -> bool:
        return not self.has_description


class StructuredDescriptionEnrich:
    def __init__(self, searcher=None):
        self._searcher = searcher

    async def run(self, candidates: list[StructuredCandidate]) -> None:
        if self._searcher is None:
            return
        cache: dict[str, list[SearchHit]] = {}
        for candidate in candidates:
            if not candidate.needs_enrichment:
                continue
            registration = next((claim.value for claim in candidate.draft.claims
                                 if claim.field == 'registration_url'), candidate.draft.page.url)
            key = normalized_url(registration)
            try:
                if key not in cache:
                    cache[key] = await asyncio.to_thread(
                        self._searcher.search,
                        f'{candidate.draft.name} {registration}', count=5,
                    )
                hit = next((item for item in cache[key] if item.snippet.strip()), None)
            except Exception:
                continue
            if hit is not None:
                candidate.context = hit.snippet.strip()
                candidate.context_url = hit.url


def deduplicate_structured(candidates: list[StructuredCandidate]) -> list[StructuredCandidate]:
    groups: list[list[StructuredCandidate]] = []
    for candidate in candidates:
        group = next((group for group in groups if can_merge(group[0].draft, candidate.draft)), None)
        if group is None:
            groups.append([candidate])
        else:
            group.append(candidate)
    result = []
    for group in groups:
        representative = group[0]
        representative.group = group
        longest = max(group, key=lambda item: len(item.context))
        representative.context = longest.context
        representative.context_url = longest.context_url or longest.draft.page.url
        representative.draft = _merge_drafts(group, representative)
        representative.claim_pages = {
            id(claim): candidate.claim_pages.get(id(claim), candidate.draft.page)
            for candidate in group
            for claim in candidate.draft.claims
        }
        result.append(representative)
    return result


def _merge_drafts(group: list[StructuredCandidate], representative: StructuredCandidate) -> ContestDraft:
    claims = [claim for candidate in group for claim in candidate.draft.claims]
    summary = max((candidate.draft.summary or '' for candidate in group), key=len, default=None) or None
    cover = next((candidate.draft.cover_url for candidate in group if candidate.draft.cover_url), None)
    return representative.draft.model_copy(update={
        'cover_url': cover,
        'summary': summary,
        'claims': claims,
    })
