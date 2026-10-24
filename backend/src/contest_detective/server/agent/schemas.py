from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from contest_detective.server.user.schemas import Profile
from contest_detective.server.contest.schemas import ContestDetail


class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1)


class AskRequest(BaseModel):
    question: str = Field(min_length=1)
    profile: Profile | None = None
    history: list[ConversationMessage] = Field(default_factory=list)

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


class Step(BaseModel):
    tool: str
    label: str


class Observation(BaseModel):
    tool: str
    summary: str
    sources: list[ToolSource] = Field(default_factory=list)


class RecommendationChoice(BaseModel):
    contest_id: str = Field(description='本轮比赛工具已返回的真实比赛 ID')
    introduction: str = Field(description='对这场比赛的简短介绍')
    reason: str = Field(description='结合用户本轮条件给出的推荐理由')


class DetectiveReply(BaseModel):
    content: str = Field(min_length=1, description='给用户的完整 Markdown 文字答复，保留介绍、比较和来源链接')
    recommendations: list[RecommendationChoice] = Field(
        description='最终推荐的比赛，按推荐顺序排列；未推荐任何比赛时返回空数组',
    )


class ContestRecommendation(BaseModel):
    contest: ContestDetail
    introduction: str | None = None
    reason: str


class ResolveRecommendations(BaseModel):
    content: str
    sources: list[ToolSource] = Field(default_factory=list)


class Answer(BaseModel):
    content: str
    sources: list[ToolSource] = Field(default_factory=list)
    recommendations: list[ContestRecommendation] = Field(default_factory=list)


class Error(BaseModel):
    message: str


class TraceEvent(BaseModel):
    type: Literal['step', 'observation', 'answer', 'error']
    payload: dict

    @model_validator(mode='after')
    def validate_payload(self):
        model = {'step': Step, 'observation': Observation, 'answer': Answer, 'error': Error}[self.type]
        self.payload = model.model_validate(self.payload).model_dump(mode='json')
        return self
