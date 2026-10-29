from typing import Annotated, Literal
from copy import deepcopy

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from contest_detective.agent.schemas import ContestReference, ContestRecommendation, Observation, Step, ToolSource
from contest_detective.agent.verification_contracts import ConfirmedClaim, VerificationMode, InvestigationPlan, InvestigationReport
from contest_detective.system.user.schemas import MatchItem, Profile

ClientId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_.:-]+$')]


def complete_nullable_contest_fields(items):
    # SSE omits nulls; the catalog DTO requires explicit nulls for an unknown value or cover.
    items = deepcopy(items)
    if isinstance(items, list):
        for item in items:
            contest = item.get('contest') if isinstance(item, dict) else None
            if not isinstance(contest, dict):
                continue
            contest.setdefault('cover_url', None)
            contest.setdefault('summary', None)
            fields = contest.get('fields', {})
            if isinstance(fields, dict):
                for field in fields.values():
                    if isinstance(field, dict):
                        field.setdefault('value', None)
    return items


class SavedStep(Step):
    type: Literal['step'] = 'step'


class SavedObservation(Observation):
    type: Literal['observation'] = 'observation'


class ProfileAttachment(BaseModel):
    name: str
    profile: Profile
    candidates: list[MatchItem]

    @field_validator('candidates', mode='before')
    @classmethod
    def complete_candidates(cls, value):
        return complete_nullable_contest_fields(value)


class SavedVerificationOptions(BaseModel):
    mode: VerificationMode | None = None
    confirmed_claims: list[ConfirmedClaim] = Field(default_factory=list)


class SavedRequest(BaseModel):
    contest: ContestReference | None = None
    profile: Profile | None = None
    verificationOptions: SavedVerificationOptions | None = None


class SavedTurn(BaseModel):
    model_config = ConfigDict(extra='forbid')

    id: ClientId
    question: str = Field(min_length=1)
    content: str = ''
    trace: list[SavedStep | SavedObservation] = Field(default_factory=list)
    sources: list[ToolSource] = Field(default_factory=list)
    status: Literal['running', 'completed', 'stopped', 'error']
    error: str | None = None
    investigationId: ClientId | None = None
    lastSeq: int = Field(default=0, ge=0)
    action: Literal['settings', 'retry', 'provide_link'] | None = None
    request: SavedRequest | None = None
    plan: InvestigationPlan | None = None
    report: InvestigationReport | None = None
    recommendations: list[ContestRecommendation] | None = None
    profileFile: ProfileAttachment | None = None

    @field_validator('recommendations', mode='before')
    @classmethod
    def complete_recommendations(cls, value):
        return complete_nullable_contest_fields(value)


class SavedConversation(BaseModel):
    model_config = ConfigDict(extra='forbid')

    id: ClientId
    title: str = Field(min_length=1, max_length=128)
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    turns: list[SavedTurn]


class ConversationImport(BaseModel):
    model_config = ConfigDict(extra='forbid')

    sessions: list[SavedConversation] = Field(max_length=50)
