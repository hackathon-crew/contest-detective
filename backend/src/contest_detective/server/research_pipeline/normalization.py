"""结构化来源归一化的中立输入和证据合并规则。"""

from dataclasses import dataclass

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft


@dataclass(frozen=True)
class NormalizationInput:
    draft: ContestDraft
    context: str
    context_url: str


def supported_claims(text: str, claims: list[ClaimIn]) -> list[ClaimIn]:
    body = ' '.join(text.split())
    return [
        claim for claim in claims
        if claim.excerpt and ' '.join(claim.excerpt.split()) in body
    ]


def merge_normalized(item: NormalizationInput, output) -> ContestDraft:
    existing = {claim.field for claim in item.draft.claims}
    context_claims = [
        claim for claim in output.claims
        if claim.field not in existing
    ]
    supported = supported_claims(item.context, context_claims)
    return item.draft.model_copy(update={
        'name': item.draft.name,
        'cover_url': item.draft.cover_url or output.cover_url,
        'summary': item.draft.summary or output.summary,
        'claims': [*item.draft.claims, *supported],
    })
