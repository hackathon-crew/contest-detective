from collections.abc import Iterator

from .schemas import TraceEvent


def ask(question: str, user_id: str | None = None) -> Iterator[TraceEvent]:
    raise NotImplementedError
