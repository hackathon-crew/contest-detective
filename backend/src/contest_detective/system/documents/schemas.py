"""Wire contracts for the dedicated companion document-answer boundary."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

MAX_QUESTION_BYTES = 24 * 1024
# Preserve the supplied evidence byte-for-byte, including surrounding whitespace.
VerbatimText = Annotated[str, StringConstraints(strip_whitespace=False)]


class DocumentPassage(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    document_id: str = Field(min_length=1, max_length=100)
    passage_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=240)
    locator: str = Field(min_length=1, max_length=120)
    text: VerbatimText = Field(min_length=1, max_length=4000)

    @field_validator('text')
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('文档片段不能为空')
        return value


class DocumentQuestion(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=1000)
    passages: list[DocumentPassage] = Field(min_length=1, max_length=8)

    @model_validator(mode='after')
    def bounded_unique_passages(self) -> Self:
        keys = [(item.document_id, item.passage_id) for item in self.passages]
        if len(set(keys)) != len(keys):
            raise ValueError('文档片段标识不能重复')
        if len(self.model_dump_json().encode('utf-8')) > MAX_QUESTION_BYTES:
            raise ValueError('问题与文档片段总量不能超过 24KiB')
        return self


class SourceCitation(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    document_id: str = Field(min_length=1, max_length=100)
    passage_id: str = Field(min_length=1, max_length=100)
    quote: VerbatimText = Field(min_length=1, max_length=1200)

    @field_validator('quote')
    @classmethod
    def nonblank_quote(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('来源引文不能为空')
        return value


class GroundedClaim(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=1200)
    citations: list[SourceCitation] = Field(min_length=1, max_length=4)


class DocumentAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid')

    status: Literal['answered', 'insufficient_evidence']
    claims: list[GroundedClaim] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def consistent_status(self) -> Self:
        if (self.status == 'answered') != bool(self.claims):
            raise ValueError('有答案时必须包含带引文的结论，证据不足时不能包含结论')
        return self
