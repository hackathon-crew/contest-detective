"""结构化来源归一化的中立输入和证据合并规则。"""

from dataclasses import dataclass
import logging

from contest_detective.contest.schemas import (DATE_FIELDS, TEXT_FIELDS, ClaimIn, ContestDraft,
    FieldResolution, PageIn, calendar_date)
from contest_detective.contest.verification import resolution_matches

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NormalizationInput:
    draft: ContestDraft
    context: str
    context_url: str
    allow_conflicts: bool = False
    merge_only: bool = False
    source_urls: tuple[str, ...] = ()


def supported_claims(text: str, claims: list[ClaimIn]) -> list[ClaimIn]:
    body = ' '.join(text.split())
    return [
        claim for claim in claims
        if (excerpt := ' '.join(claim.excerpt.split())) and excerpt in body
    ]


def merge_normalized(item: NormalizationInput, output) -> ContestDraft:
    if item.merge_only:
        resolutions = {}
        for merge in output.field_merges:
            expected = {index for index, claim in enumerate(item.draft.claims) if claim.field == merge.field}
            indexes = merge.claim_indexes
            if (merge.field not in TEXT_FIELDS or not expected or len(set(indexes)) != len(indexes)
                    or set(indexes) != expected or merge.field in resolutions):
                raise ValueError('文字合并必须完整引用同一字段的全部输入断言')
            resolutions[merge.field] = FieldResolution(value=merge.value, conflicting=merge.conflicting,
                reason=merge.reason, claims=[item.draft.claims[index] for index in indexes])
        return item.draft.model_copy(update={'field_resolutions': resolutions})
    existing: dict[str, list[ClaimIn]] = {}
    for claim in item.draft.claims:
        existing.setdefault(claim.field, []).append(claim)
    context_claims = [
        claim for claim in output.claims
        if item.allow_conflicts or claim.field not in existing or _refines_date(claim, existing[claim.field])
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


async def reconcile_fields(name, fields, normalizer, *, previous=None):
    """一次整理一场赛事的多值文字字段；读取和完全相同的值无需模型。"""
    previous = previous or {}
    resolutions = {field: decision for field, decision in previous.items()
                   if field in fields and resolution_matches(field, fields[field].sources, decision)}
    pending = [field for field in sorted(fields) if field in TEXT_FIELDS and field not in resolutions
               and len({source.value for source in fields[field].sources}) > 1]
    if not pending or normalizer is None:
        return resolutions
    claims, urls = [], []
    for field in pending:
        for source in fields[field].sources:
            claims.append(ClaimIn(field=field, value=source.value, excerpt=source.excerpt, precision=source.precision))
            urls.append(source.url)
    first = fields[pending[0]].sources[0]
    draft = ContestDraft(name=name, page=PageIn(**{key: getattr(first, key) for key in PageIn.model_fields}), claims=claims)
    merged = await normalizer(NormalizationInput(draft=draft, context='', context_url=first.url,
        merge_only=True, source_urls=tuple(urls)))
    for field, decision in merged.field_resolutions.items():
        if field in pending and resolution_matches(field, fields[field].sources, decision):
            resolutions[field] = decision
    return resolutions


def _refines_date(claim: ClaimIn, existing: list[ClaimIn]) -> bool:
    return (
        claim.field in DATE_FIELDS and claim.precision == 'datetime'
        and all(original.precision == 'day'
                and calendar_date(original.value, 'day') == calendar_date(claim.value)
                for original in existing)
    )
