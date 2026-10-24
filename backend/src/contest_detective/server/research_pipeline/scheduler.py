from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from contest_detective.server.research_pipeline.pipeline.execute import run_pipeline


def start_scheduler(session_factory, interval_minutes: int, *, extractor=None) -> BackgroundScheduler | None:
    if interval_minutes <= 0:
        return None
    scheduler = BackgroundScheduler(timezone=timezone.utc)

    def sync():
        run_pipeline(session_factory, extractor=extractor)

    scheduler.add_job(
        sync, 'interval', minutes=interval_minutes, id='contest-source-sync',
        next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True,
    )
    scheduler.start()
    return scheduler
