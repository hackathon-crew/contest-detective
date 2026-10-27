import asyncio
import sys

from fastapi import Request
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from contest_detective.framework.config import get_database_settings


def _configure_event_loop(url: str) -> None:
    # psycopg's async mode cannot run on Windows' default ProactorEventLoop.
    if sys.platform == 'win32' and make_url(url).get_backend_name() == 'postgresql':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def async_database_url(url: str) -> str:
    """Map a runtime URL to its async driver without rewriting unrelated parts."""
    parsed = make_url(url)
    backend = parsed.get_backend_name()
    if backend == "sqlite":
        return parsed.set(drivername="sqlite+aiosqlite").render_as_string(hide_password=False)
    if backend == "postgresql":
        return parsed.set(drivername="postgresql+psycopg").render_as_string(hide_password=False)
    raise ValueError("不支持的异步数据库地址")


def _async_connect_args(url: str) -> dict:
    if make_url(url).get_backend_name() == "postgresql":
        return {"application_name": "contest-detective", "options": "-c timezone=UTC"}
    return {}


_database_url = get_database_settings().url
_configure_event_loop(_database_url)
async_engine = create_async_engine(async_database_url(_database_url), connect_args=_async_connect_args(_database_url))
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_async_session(request: Request):
    async with request.app.state.async_session_factory() as session:
        yield session
