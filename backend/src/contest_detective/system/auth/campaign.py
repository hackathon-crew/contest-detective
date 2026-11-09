from datetime import datetime, timezone
from typing import get_args
from uuid import UUID

from sqlalchemy import case, func, select, update
from sqlalchemy.dialects import postgresql, sqlite

from .campaign_contracts import (
    LAUNCH_CAMPAIGN,
    CampaignArrival,
    CampaignCounts,
    CampaignReport,
    CampaignSource,
)
from .models import CampaignVisit

COOKIE_NAME = 'cd_campaign'
COOKIE_MAX_AGE = 30 * 24 * 60 * 60


def _browser_id(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


def record_arrival(session, arrival: CampaignArrival, cookie: str | None) -> str:
    visitor = _browser_id(cookie) or str(arrival.visitor_id)
    dialect = postgresql if session.get_bind().dialect.name == 'postgresql' else sqlite
    session.execute(dialect.insert(CampaignVisit).values(
        campaign=arrival.campaign,
        visitor_id=visitor,
        source=arrival.source,
        content=arrival.content,
        first_seen_at=datetime.now(timezone.utc),
        registrations=0,
    ).on_conflict_do_nothing(index_elements=['campaign', 'visitor_id']))
    session.commit()
    return visitor


async def record_registration(session, cookie: str | None) -> None:
    visitor = _browser_id(cookie)
    if visitor is None:
        return
    await session.execute(update(CampaignVisit).where(
        CampaignVisit.campaign == LAUNCH_CAMPAIGN,
        CampaignVisit.visitor_id == visitor,
    ).values(registrations=CampaignVisit.registrations + 1))


def _counts(visitors: int, converted: int, registrations: int) -> CampaignCounts:
    return CampaignCounts(
        visitors=visitors,
        converted_visitors=converted,
        registrations=registrations,
        conversion_rate=converted / visitors if visitors else None,
    )


def report(session) -> CampaignReport:
    rows = session.execute(select(
        CampaignVisit.source,
        func.count(),
        func.sum(case((CampaignVisit.registrations > 0, 1), else_=0)),
        func.sum(CampaignVisit.registrations),
        func.min(CampaignVisit.first_seen_at),
    ).where(CampaignVisit.campaign == LAUNCH_CAMPAIGN).group_by(CampaignVisit.source)).all()
    by_source = {source: CampaignCounts() for source in get_args(CampaignSource)}
    for source, visitors, converted, registrations, _ in rows:
        by_source[source] = _counts(visitors, converted, registrations)
    first_seen_at = min((row[4] for row in rows), default=None)
    if first_seen_at is not None and first_seen_at.tzinfo is None:
        first_seen_at = first_seen_at.replace(tzinfo=timezone.utc)
    return CampaignReport(
        campaign=LAUNCH_CAMPAIGN,
        as_of=datetime.now(timezone.utc),
        first_seen_at=first_seen_at,
        total=_counts(
            sum(item.visitors for item in by_source.values()),
            sum(item.converted_visitors for item in by_source.values()),
            sum(item.registrations for item in by_source.values()),
        ),
        by_source=by_source,
    )
