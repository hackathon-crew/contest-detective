from fastapi import Request
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from contest_detective.framework.config import get_database_settings

async_engine = create_async_engine(get_database_settings().url.replace('sqlite:', 'sqlite+aiosqlite:', 1))
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_async_session(request: Request):
    async with request.app.state.async_session_factory() as session:
        yield session
