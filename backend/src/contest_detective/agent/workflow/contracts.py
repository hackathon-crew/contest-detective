"""本轮意图与工作状态；这些对象不作为新的聊天或赛事存储。"""
from dataclasses import dataclass, field
from typing import Literal, Protocol, TYPE_CHECKING

from pydantic import AwareDatetime, BaseModel, Field

from contest_detective.contest.schemas import EvidenceField

if TYPE_CHECKING:
    from pydantic_ai.usage import RunUsage, UsageLimits
    from contest_detective.agent.schemas import ConversationMessage, DetectiveReply
    from contest_detective.agent.tools import ToolDeps


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
