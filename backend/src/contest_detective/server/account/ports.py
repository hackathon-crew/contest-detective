from datetime import date
from typing import Protocol

from .schemas import TrackingConditions


class TrackingParser(Protocol):
    async def __call__(self, text: str, today: date) -> TrackingConditions: ...
