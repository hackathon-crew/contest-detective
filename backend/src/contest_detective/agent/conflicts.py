"""Bind proposed source conflicts to receipts from the current investigation."""
from collections.abc import Sequence

from .verification_contracts import ConflictDecision, ReportEvidence, SourceConflict


def build_conflicts(decisions: Sequence[ConflictDecision], evidence: Sequence[ReportEvidence]) -> list[SourceConflict]:
    # The contract is available before the investigation starts producing decisions.
    return []
