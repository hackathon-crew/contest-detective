"""FastAPI 应用工厂。装配异常处理和 API 路由。"""

from fastapi import FastAPI

from contest_detective.common.result import Response
from contest_detective.web.api import router
from contest_detective.web.handler import register_exception_handlers


def create_app() -> FastAPI:
    app = FastAPI(title="比赛侦探", version="0.1.0")
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
