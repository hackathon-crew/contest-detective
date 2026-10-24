"""FastAPI 应用工厂。装配异常处理和 API 路由。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.async_db import AsyncSessionLocal
from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.db import SessionLocal, init_db
from contest_detective.server.research_pipeline.scheduler import start_scheduler

from contest_detective.server.notifications.service import start_account_scheduler

from contest_detective.common.result import Response
from contest_detective.web.api import router
from contest_detective.web.handler import register_exception_handlers
from contest_detective.web.bootstrap.source_sync import (
    configured_extractor, configured_normalizer, configured_tavily,
)


def create_app(*, db_engine=None, async_session_factory=None,
               sync_interval_minutes: int | None = None, sync_daily_at: str | None = None,
               sync_window_minutes: int | None = None, sync_extractor=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        init_db(db_engine)
        factory = sessionmaker(bind=db_engine, expire_on_commit=False) if db_engine is not None else SessionLocal
        settings = get_app_settings()
        interval = sync_interval_minutes if sync_interval_minutes is not None else settings.sync_interval_minutes
        daily_at = sync_daily_at if sync_daily_at is not None else settings.sync_daily_at
        window_minutes = sync_window_minutes if sync_window_minutes is not None else settings.sync_window_minutes
        extractor = sync_extractor
        if (daily_at or interval > 0) and extractor is None:
            extractor = configured_extractor(factory)
        normalizer = configured_normalizer() if (daily_at or interval > 0) else None
        tavily = configured_tavily() if normalizer is not None else None
        scheduler_kwargs = {'extractor': extractor}
        if normalizer is not None:
            scheduler_kwargs['normalizer'] = normalizer
        if tavily is not None:
            scheduler_kwargs['tavily'] = tavily
        try:
            scheduler = start_scheduler(
                factory, interval, **scheduler_kwargs,
                daily_at=daily_at, window_minutes=window_minutes,
            )
        except TypeError as exc:
            if 'unexpected keyword argument' not in str(exc):
                raise
            scheduler = start_scheduler(
                factory, interval, extractor=extractor,
                daily_at=daily_at, window_minutes=window_minutes,
            )
        account_scheduler = start_account_scheduler(factory)
        try:
            yield
        finally:
            if account_scheduler is not None:
                account_scheduler.shutdown(wait=True)
            if scheduler is not None:
                scheduler.shutdown(wait=True)
            await _app.state.async_session_factory.kw["bind"].dispose()

    app = FastAPI(title="比赛侦探", version="0.1.0", lifespan=lifespan)
    app.state.async_session_factory = async_session_factory or AsyncSessionLocal
    register_exception_handlers(app)
    app.include_router(router)

    @app.get("/health", include_in_schema=False)
    def health() -> Response[dict[str, str]]:
        return Response.success({"status": "ok"})

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run(
        "contest_detective.web.bootstrap.app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
