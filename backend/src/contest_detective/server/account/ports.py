from datetime import date
from typing import Protocol

from .schemas import MailPreview, TrackingConditions


class TrackingParser(Protocol):
    async def __call__(self, text: str, today: date) -> TrackingConditions: ...


class Mailer(Protocol):
    def send(self, message: MailPreview) -> None: ...
