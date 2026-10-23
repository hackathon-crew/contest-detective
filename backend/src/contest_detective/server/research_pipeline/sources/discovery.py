from pydantic import BaseModel


class DiscoveryReport(BaseModel):
    discovered: int = 0
    saved: int = 0
    failed: int = 0
    skipped: int = 0
