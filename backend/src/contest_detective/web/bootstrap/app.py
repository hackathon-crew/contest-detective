"""FastAPI 应用工厂。装配异常处理和 API 路由。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.async_db import AsyncSessionLocal
from contest_detective.framework.config.app import get_app_settings
from contest_detective.framework.db import SessionLocal, init_db
from contest_detective.server.research_pipeline.scheduler import start_scheduler

from contest_detective.common.result import Response
from contest_detective.web.api import router
from contest_detective.web.handler import register_exception_handlers
from contest_detective.web.bootstrap.source_sync import configured_extractor


def create_app(*, db_engine=None, async_session_factory=None,
               sync_interval_minutes: int | None = None, sync_extractor=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        init_db(db_engine)
        factory = sessionmaker(bind=db_engine, expire_on_commit=False) if db_engine is not None else SessionLocal
        interval = sync_interval_minutes if sync_interval_minutes is not None else get_app_settings().sync_interval_minutes
        extractor = sync_extractor
        if interval > 0 and extractor is None:
            extractor = configured_extractor(factory)
        scheduler = start_scheduler(factory, interval, extractor=extractor) if extractor is not None else start_scheduler(factory, interval)
        try:
            yield
        finally:
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
