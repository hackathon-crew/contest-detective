"""FastAPI 应用工厂。装配异常处理和 API 路由。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from contest_detective.framework.db import init_db
from contest_detective.framework.async_db import AsyncSessionLocal

from contest_detective.common.result import Response
from contest_detective.web.api import router
from contest_detective.web.handler import register_exception_handlers


def create_app(*, db_engine=None, async_session_factory=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app):
        init_db(db_engine)
        try:
            yield
        finally:
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
