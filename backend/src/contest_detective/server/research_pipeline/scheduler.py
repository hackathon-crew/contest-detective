from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from contest_detective.server.research_pipeline.service import run_sync


def start_scheduler(session_factory, interval_minutes: int, *, extractor=None) -> BackgroundScheduler | None:
    if interval_minutes <= 0:
        return None
    scheduler = BackgroundScheduler(timezone=timezone.utc)
    scheduler.add_job(
        run_sync, 'interval', minutes=interval_minutes, args=[session_factory],
        kwargs={'extractor': extractor} if extractor is not None else {},
        id='contest-source-sync', next_run_time=datetime.now(timezone.utc),
        max_instances=1, coalesce=True,
    )
    scheduler.start()
    return scheduler
