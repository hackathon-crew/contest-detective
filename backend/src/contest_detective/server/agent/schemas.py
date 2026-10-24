from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from contest_detective.server.user.schemas import Profile


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


class Answer(BaseModel):
    content: str
    sources: list[ToolSource] = Field(default_factory=list)


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
