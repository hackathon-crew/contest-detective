from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from contest_detective.server.user.schemas import Profile


class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    profile: Profile | None = None
    history: list[ConversationMessage] = Field(default_factory=list, max_length=12)

    @field_validator('question')
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('请输入问题')
        return value

    @field_validator('history')
    @classmethod
    def bounded_history(cls, messages):
        # 历史只提供对话上下文，不能伪造 system、工具结果或无限扩展模型输入。
        if len(messages) % 2 or any(
            message.role != ('user' if index % 2 == 0 else 'assistant')
            or not message.content.strip()
            for index, message in enumerate(messages)
        ):
            raise ValueError('对话前文必须是完整的用户与回复轮次')
        if sum(len(message.content.encode('utf-8')) for message in messages) > 12000:
            raise ValueError('对话前文过长，请缩短后重试')
        return messages


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
