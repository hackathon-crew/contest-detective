from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

LAUNCH_CAMPAIGN = 'inkpaw_launch_202611'
CampaignSource = Literal['x', 'xiaohongshu', 'reddit', 'github']


class CampaignArrival(BaseModel):
    campaign: Literal['inkpaw_launch_202611']
    visitor_id: UUID
    source: CampaignSource
    content: str = Field(default='', max_length=48, pattern=r'^[a-z0-9_-]*$')


class CampaignCounts(BaseModel):
    visitors: int = 0
    converted_visitors: int = 0
    registrations: int = 0
    conversion_rate: float | None = None


class CampaignReport(BaseModel):
    campaign: Literal['inkpaw_launch_202611']
    as_of: datetime
    first_seen_at: datetime | None
    total: CampaignCounts
    by_source: dict[CampaignSource, CampaignCounts]
