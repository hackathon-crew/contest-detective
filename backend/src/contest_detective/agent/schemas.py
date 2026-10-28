import re
from typing import Literal
from datetime import datetime
from uuid import UUID

from .verification_contracts import ConfirmedClaim, VerificationMode, ClaimAssessment, InvestigationReport, InvestigationPlan
from contest_detective.research.contracts import SearchExecution

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from contest_detective.system.user.schemas import Profile
from contest_detective.contest.schemas import ContestDetail


class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1)


class AskRequest(BaseModel):
    investigation_id: UUID | None = None
    question: str = Field(min_length=1)
    profile: Profile | None = None
    history: list[ConversationMessage] = Field(default_factory=list)
    mode: VerificationMode | None = None
    confirmed_claims: list[ConfirmedClaim] = Field(default_factory=list)

    @model_validator(mode='after')
    def validate_confirmed_claims(self):
        if self.confirmed_claims and self.mode not in {'realtime', 'deep'}:
            raise ValueError('已确认说法需使用实时核验或深度调查模式')
        if any(not re.fullmatch(r'[A-Za-z0-9_.:-]+', item.id) or not item.text.strip() for item in self.confirmed_claims):
            raise ValueError('核验说法 ID 与文字不能为空')
        if len({item.id for item in self.confirmed_claims}) != len(self.confirmed_claims):
            raise ValueError('核验说法 ID 不能重复')
        return self

    @field_validator('question')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('请输入问题')
        return value


class ToolSource(BaseModel):
    title: str
    url: str
    site: str = ''
    is_official: bool = False
    stale: bool = False
    provider: str | None = None
    query: str | None = None
    retrieved_at: datetime | None = None


class Step(BaseModel):
    tool: str
    label: str


class Observation(BaseModel):
    execution: SearchExecution | None = None
    tool: str
    summary: str
    sources: list[ToolSource] = Field(default_factory=list)


class RecommendationChoice(BaseModel):
    contest_id: str = Field(description='本轮比赛工具已返回的真实比赛 ID')
    introduction: str = Field(default='', description='对这场比赛的简短介绍')
    reason: str = Field(default='', description='结合用户本轮条件给出的推荐理由')


class DetectiveReply(BaseModel):
    assessments: list[ClaimAssessment] = Field(default_factory=list, description="实时/深度模式逐条引用 cite_evidence 返回的证据 ID；证据不足必须标 insufficient")
    content: str = Field(min_length=1, description='给用户的完整 Markdown 文字答复，保留介绍、比较和来源链接')
    recommendations: list[RecommendationChoice] = Field(
        default_factory=list, description='最终推荐的比赛，按推荐顺序排列；未推荐任何比赛时返回空数组',
    )


    @field_validator('recommendations', 'assessments', mode='before')
    @classmethod
    def optional_metadata(cls, value, info: ValidationInfo):
        # 附加信息不完整时只放弃该项，不能让已经生成的正文再次请求模型后丢失。
        if not isinstance(value, list):
            return []
        model = RecommendationChoice if info.field_name == 'recommendations' else ClaimAssessment
        items = []
        for item in value:
            try:
                items.append(model.model_validate(item))
            except (ValueError, TypeError):
                continue
        return items


class ContestRecommendation(BaseModel):
    contest: ContestDetail
    introduction: str | None = None
    reason: str


class ResolveRecommendations(BaseModel):
    content: str
    sources: list[ToolSource] = Field(default_factory=list)


class Answer(BaseModel):
    report: InvestigationReport | None = None
    content: str
    sources: list[ToolSource] = Field(default_factory=list)
    recommendations: list[ContestRecommendation] = Field(default_factory=list)


class Error(BaseModel):
    message: str
    action: Literal['settings', 'retry', 'provide_link'] | None = None


class TraceEvent(BaseModel):
    seq: int = 0
    type: Literal['step', 'observation', 'answer', 'error', 'plan']
    payload: dict

    @model_validator(mode='after')
    def validate_payload(self):
        model = {'step': Step, 'observation': Observation, 'answer': Answer, 'error': Error, 'plan': InvestigationPlan}[self.type]
        self.payload = model.model_validate(self.payload).model_dump(mode='json', exclude_none=True)
        return self
