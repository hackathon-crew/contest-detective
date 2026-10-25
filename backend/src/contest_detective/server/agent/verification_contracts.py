"""Verification data contracts only; execution is deliberately not implemented."""
from datetime import datetime
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from contest_detective.server.research_pipeline.contracts import SearchExecution

VerificationMode = Literal['database', 'realtime', 'deep']
LiveVerificationMode = Literal['realtime', 'deep']
ClaimVerdict = Literal['supported', 'refuted', 'conflicting', 'insufficient']
SourceLevel = Literal['official', 'reposted', 'conflict', 'not_found']


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ConfirmedClaim(Contract):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    origin: Literal['user', 'screenshot']


class VerificationRequestFields(Contract):
    # None preserves the existing ordinary mixed workflow, not realtime proof.
    mode: VerificationMode | None = None
    confirmed_claims: list[ConfirmedClaim] = Field(default_factory=list)


class PlanStep(Contract):
    id: str
    purpose: str
    query: str
    claim_ids: list[str] = Field(default_factory=list)


class InvestigationPlan(Contract):
    mode: LiveVerificationMode
    steps: list[PlanStep]


class ReportEvidence(Contract):
    id: str
    title: str
    url: str
    excerpt: str
    content_hash: str | None = None
    retrieved_at: datetime | None = None
    evidence_kind: Literal['search_snippet', 'fetched_page', 'database_record']
    provider: str | None = None
    query_ids: list[str] = Field(default_factory=list)
    source_level: SourceLevel
    source_lineage: str | None = None
    historical: bool = False


class ClaimAssessment(Contract):
    id: str
    text: str
    verdict: ClaimVerdict
    source_level: SourceLevel
    evidence_ids: list[str] = Field(default_factory=list)
    comparison: str
    limitations: list[str] = Field(default_factory=list)


class InvestigationReport(Contract):
    version: Literal[1] = 1
    mode: LiveVerificationMode
    status: Literal['complete', 'incomplete', 'blocked']
    generated_at: datetime
    plan: InvestigationPlan | None = None
    queries: list[SearchExecution] = Field(default_factory=list)
    claims: list[ClaimAssessment] = Field(default_factory=list)
    evidence: list[ReportEvidence] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ScopeDecision(Contract):
    outcome: Literal['allowed_contest', 'needs_clarification', 'out_of_scope']
    message: str


class VerificationScope(Protocol):
    async def check(self, question: str, claims: list[ConfirmedClaim]) -> ScopeDecision: ...


class EvidenceReportBuilder(Protocol):
    def build(self, mode: LiveVerificationMode, plan: InvestigationPlan | None,
              queries: list[SearchExecution], claims: list[ConfirmedClaim],
              evidence: list[ReportEvidence]) -> InvestigationReport: ...


class ReportExporter(Protocol):
    def markdown(self, report: InvestigationReport) -> str: ...
    def json(self, report: InvestigationReport) -> str: ...
