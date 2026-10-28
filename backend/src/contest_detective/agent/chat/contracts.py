from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from contest_detective.agent.schemas import ContestRecommendation, Observation, Step, ToolSource
from contest_detective.agent.verification_contracts import InvestigationPlan, InvestigationReport
from contest_detective.system.user.schemas import MatchItem, Profile

ClientId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_.:-]+$')]


class SavedStep(Step):
    type: Literal['step'] = 'step'


class SavedObservation(Observation):
    type: Literal['observation'] = 'observation'


class ProfileAttachment(BaseModel):
    name: str
    profile: Profile
    candidates: list[MatchItem]


class SavedTurn(BaseModel):
    model_config = ConfigDict(extra='forbid')

    id: ClientId
    question: str = Field(min_length=1)
    content: str = ''
    trace: list[SavedStep | SavedObservation] = Field(default_factory=list)
    sources: list[ToolSource] = Field(default_factory=list)
    status: Literal['running', 'completed', 'stopped', 'error']
    error: str | None = None
    plan: InvestigationPlan | None = None
    report: InvestigationReport | None = None
    recommendations: list[ContestRecommendation] | None = None
    profileFile: ProfileAttachment | None = None


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
