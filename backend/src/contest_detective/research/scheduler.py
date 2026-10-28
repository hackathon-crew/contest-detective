"""按小时间隔或每日窗口运行同步管道。

配置了每日时刻时，北京时间每个窗口只跑一轮，不再按小时间隔重复。
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from contest_detective.research.pipeline.execute import run_pipeline

SHANGHAI = ZoneInfo("Asia/Shanghai")
JOB_ID = "contest-source-sync"


def within_daily_window(moment: datetime, daily_at: str, window_minutes: int) -> bool:
    """时刻落在当天窗口内，或落在跨过零点的上一个窗口内。"""
    local = moment.astimezone(SHANGHAI)
    start = datetime.combine(local.date(), _clock(daily_at), tzinfo=SHANGHAI)
    window = timedelta(minutes=window_minutes)
    if start <= local < start + window:
        return True
    previous = start - timedelta(days=1)
    return previous <= local < previous + window


def _clock(daily_at: str) -> time:
    hour, minute = daily_at.split(":")
    return time(int(hour), int(minute))


def window_key(moment: datetime, daily_at: str, window_minutes: int) -> str | None:
    """窗口起始日。跨过零点的后半夜仍算前一天的那一轮。"""
    if not within_daily_window(moment, daily_at, window_minutes):
        return None
    local = moment.astimezone(SHANGHAI)
    start = datetime.combine(local.date(), _clock(daily_at), tzinfo=SHANGHAI)
    if local < start:
        start -= timedelta(days=1)
    return start.date().isoformat()


def _claim(session_factory, ran_on: str) -> bool:
    from contest_detective.research.models import PipelineRun

    with session_factory() as session:
        row = session.get(PipelineRun, JOB_ID)
        if row is not None and row.ran_on == ran_on:
            return False
        if row is None:
            session.add(PipelineRun(job_id=JOB_ID, ran_on=ran_on))
        else:
            row.ran_on = ran_on
        session.commit()
        return True


def _already_ran(session_factory, ran_on: str) -> bool:
    from contest_detective.research.models import PipelineRun

    with session_factory() as session:
        row = session.get(PipelineRun, JOB_ID)
        return row is not None and row.ran_on == ran_on


def start_scheduler(session_factory, interval_minutes: int, *, extractor=None, normalizer=None, tavily=None,
                    daily_at: str = "", window_minutes: int = 60, detail_fetcher=None,
                    after_sync=None) -> BackgroundScheduler | None:
    if daily_at:
        return _start_daily(session_factory, daily_at, window_minutes, extractor, normalizer, tavily, detail_fetcher, after_sync)
    if interval_minutes <= 0:
        return None
    scheduler = BackgroundScheduler(timezone=timezone.utc)

    def sync():
        kwargs = {'extractor': extractor}
        if normalizer is not None:
            kwargs['normalizer'] = normalizer
        if tavily is not None:
            kwargs['tavily'] = tavily
        if detail_fetcher is not None:
            kwargs['detail_fetcher'] = detail_fetcher
        run_pipeline(session_factory, **kwargs)
        if after_sync is not None:
            after_sync()

    scheduler.add_job(
        sync, 'interval', minutes=interval_minutes, id=JOB_ID,
        next_run_time=datetime.now(timezone.utc), max_instances=1, coalesce=True,
    )
    scheduler.start()
    return scheduler


def _start_daily(session_factory, daily_at: str, window_minutes: int, extractor, normalizer, tavily, detail_fetcher, after_sync) -> BackgroundScheduler:
    clock = _clock(daily_at)
    scheduler = BackgroundScheduler(timezone=SHANGHAI)

    def sync():
        key = window_key(datetime.now(SHANGHAI), daily_at, window_minutes)
        if key is None or not _claim(session_factory, key):
            return
        kwargs = {'extractor': extractor}
        if normalizer is not None:
            kwargs['normalizer'] = normalizer
        if tavily is not None:
            kwargs['tavily'] = tavily
        if detail_fetcher is not None:
            kwargs['detail_fetcher'] = detail_fetcher
        run_pipeline(session_factory, **kwargs)
        if after_sync is not None:
            after_sync()

    now = datetime.now(SHANGHAI)
    key = window_key(now, daily_at, window_minutes)
    due = {'next_run_time': now} if key is not None and not _already_ran(session_factory, key) else {}
    scheduler.add_job(
        sync, CronTrigger(hour=clock.hour, minute=clock.minute, timezone=SHANGHAI),
        id=JOB_ID, max_instances=1, coalesce=True,
        misfire_grace_time=window_minutes * 60, **due,
    )
    scheduler.start()
    return scheduler
