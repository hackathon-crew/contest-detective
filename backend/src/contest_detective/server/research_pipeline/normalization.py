"""结构化来源归一化的中立输入和证据合并规则。"""

from dataclasses import dataclass
import logging

from contest_detective.server.contest.schemas import DATE_FIELDS, ClaimIn, ContestDraft, calendar_date

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NormalizationInput:
    draft: ContestDraft
    context: str
    context_url: str


def supported_claims(text: str, claims: list[ClaimIn]) -> list[ClaimIn]:
    body = ' '.join(text.split())
    return [
        claim for claim in claims
        if (excerpt := ' '.join(claim.excerpt.split())) and excerpt in body
    ]


def merge_normalized(item: NormalizationInput, output) -> ContestDraft:
    existing: dict[str, list[ClaimIn]] = {}
    for claim in item.draft.claims:
        existing.setdefault(claim.field, []).append(claim)
    context_claims = [
        claim for claim in output.claims
        if claim.field not in existing or _refines_date(claim, existing[claim.field])
    ]
    supported = supported_claims(item.context, context_claims)
    logger.info('Normalization claims accepted=%s rejected_evidence=%s skipped_existing=%s',
                len(supported), len(context_claims) - len(supported), len(output.claims) - len(context_claims))
    return item.draft.model_copy(update={
        'name': item.draft.name,
        'cover_url': item.draft.cover_url or output.cover_url,
        'summary': item.draft.summary or output.summary,
        'claims': [*item.draft.claims, *supported],
    })


def _refines_date(claim: ClaimIn, existing: list[ClaimIn]) -> bool:
    return (
        claim.field in DATE_FIELDS and claim.precision == 'datetime'
        and all(original.precision == 'day'
                and calendar_date(original.value, 'day') == calendar_date(claim.value)
                for original in existing)
    )
