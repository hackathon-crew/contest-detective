from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class OutgoingMail:
    key: str
    sender: str
    recipient: str
    subject: str
    html: str
    text: str


@dataclass(frozen=True)
class DeliveryReceipt:
    provider_id: str


class MailTransport(Protocol):
    def send(self, message: OutgoingMail) -> DeliveryReceipt: ...
