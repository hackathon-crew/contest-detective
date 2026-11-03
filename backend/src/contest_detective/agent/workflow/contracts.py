"""本轮意图与工作状态；这些对象不作为新的聊天或赛事存储。"""
from dataclasses import dataclass, field
from math import isfinite
from typing import Literal, Protocol, TYPE_CHECKING

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from contest_detective.contest.schemas import ContestField, EvidenceField

if TYPE_CHECKING:
    from pydantic_ai.usage import RunUsage, UsageLimits
    from contest_detective.agent.schemas import ConversationMessage, DetectiveReply
    from contest_detective.agent.tools import ToolDeps


class RequestedFact(BaseModel):
    field: EvidenceField = Field(description='到场义务或参赛要求用 entry_requirements；venue 只表示具体场馆或地址。不能把“必须到场”映射成场馆地址。')
    quote: str = Field(min_length=1)


class FactCondition(BaseModel):
    field: ContestField
    operator: Literal['known', 'equals', 'contains', 'minimum', 'maximum', 'positive']
    value: str | float | None = None
    currency: Literal['CNY', 'USD'] | None = None
    quote: str = Field(min_length=1)

    @model_validator(mode='after')
    def comparison_value(self):
        if self.operator in {'equals', 'contains', 'minimum', 'maximum'} and self.value is None:
            raise ValueError('比较条件必须给出值')
        if self.operator in {'minimum', 'maximum'} and not isinstance(self.value, (int, float)):
            raise ValueError('数值范围必须使用数值')
        if isinstance(self.value, float) and not isfinite(self.value):
            raise ValueError('比较值必须是有限数值')
        if self.operator == 'contains' and not isinstance(self.value, str):
            raise ValueError('包含条件必须使用文本')
        if self.operator in {'minimum', 'maximum', 'positive'} and self.field not in {
            'prize', 'entry_fee', 'team_size', 'past_statistics'}:
            raise ValueError('日期窗口使用查询日期字段，数值条件只用于金额或人数')
        return self


class QueryIntent(BaseModel):
    kind: Literal['discovery', 'detail', 'comparison'] = 'discovery'
    keyword: str | None = None
    mode: Literal['online', 'offline', 'hybrid'] | None = None
    city: str | None = None
    status: Literal['upcoming', 'ongoing', 'ended'] | None = None
    date_from: AwareDatetime | None = None
    date_to: AwareDatetime | None = None
    date_kind: Literal['deadline', 'registration_deadline', 'submission_deadline', 'start_at', 'end_at'] = 'deadline'
    count: int = Field(default=3, ge=1)
    use_profile: bool = True
    fresh: bool = False
    comparison_queries: list[str] = Field(default_factory=list)
    fields: list[EvidenceField] = Field(default_factory=list)
    requested_facts: list[RequestedFact] = Field(default_factory=list)
    conditions: list[FactCondition] = Field(default_factory=list)


@dataclass
class WorkflowState:
    intent: QueryIntent
    main_id: str | None = None
    comparison_ids: set[str] = field(default_factory=set)
    qualified_ids: list[str] = field(default_factory=list)
    nearby: dict[str, list[str]] = field(default_factory=dict)
    phase: Literal['retrieval', 'research', 'answer'] = 'retrieval'
    seen_material: set[str] = field(default_factory=set)
    failed_paths: set[str] = field(default_factory=set)
    stagnant_rounds: int = 0
    replanned: bool = False
    stop_reason: str | None = None


class WorkflowExecutor(Protocol):
    async def prepare(self, deps: 'ToolDeps', question: str, history: list['ConversationMessage'],
                      usage: 'RunUsage', limits: 'UsageLimits') -> WorkflowState: ...

    async def complete(self, deps: 'ToolDeps', usage: 'RunUsage', limits: 'UsageLimits') -> 'DetectiveReply': ...
