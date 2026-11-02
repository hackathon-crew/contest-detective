"""Bind proposed source conflicts to receipts from the current investigation."""
from collections.abc import Iterable, Mapping, Sequence

from .schemas import ToolSource
from .verification import safe_evidence_url
from .verification_contracts import ConflictDecision, ReportEvidence, SourceConflict


def conflict_evidence(read_contests: Iterable[dict], fetched_pages: Mapping[str, str],
                      sources: Mapping[str, ToolSource]) -> list[ReportEvidence]:
    evidence = []
    for contest in read_contests:
        for value in contest['fields'].values():
            for source in value['sources']:
                if safe_evidence_url(source['url']):
                    evidence.append(ReportEvidence(id=source['url'], title=source['title'], url=source['url'],
                        excerpt=source['excerpt'], evidence_kind='database_record', historical=source['stale'],
                        source_level='official' if source['is_official'] else 'reposted'))
    for url, text in fetched_pages.items():
        if safe_evidence_url(url):
            source = sources[url]
            evidence.append(ReportEvidence(id=url, title=source.title, url=url, excerpt=text,
                evidence_kind='fetched_page', source_level='official' if source.is_official else 'reposted',
                retrieved_at=source.retrieved_at, provider=source.provider))
    return evidence


def build_conflicts(decisions: Sequence[ConflictDecision], evidence: Sequence[ReportEvidence]) -> list[SourceConflict]:
    conflicts = []
    for decision in decisions:
        if decision.accepted_statement is not None and decision.accepted_statement >= len(decision.statements):
            continue
        statements = []
        for choice in decision.statements:
            receipt = next((item for item in evidence if item.id == choice.evidence_id and choice.text in item.excerpt), None)
            if receipt is None:
                break
            statements.append({'text': choice.text, 'evidence': receipt.model_copy(update={'excerpt': choice.text})})
        if len(statements) != len(decision.statements) or len({item['text'] for item in statements}) < 2:
            continue
        conflicts.append(SourceConflict(statements=statements, accepted_statement=decision.accepted_statement,
            reason=decision.reason, blocks_participation=decision.blocks_participation and decision.accepted_statement is not None))
    return conflicts
