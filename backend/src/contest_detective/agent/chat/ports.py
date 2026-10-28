from typing import Protocol

from contest_detective.agent.schemas import TraceEvent
from .contracts import SavedConversation


class ConversationStore(Protocol):
    """Every operation is scoped to the authenticated owner supplied at construction."""

    def list_sessions(self) -> list[SavedConversation]: ...

    def import_sessions(self, sessions: list[SavedConversation]) -> None: ...

    def start(self, conversation_id: str, turn_id: str, question: str) -> None: ...

    def record(self, conversation_id: str, turn_id: str, event: TraceEvent) -> None: ...

    def finish(self, conversation_id: str, turn_id: str) -> None: ...

    def delete_all(self) -> None: ...
