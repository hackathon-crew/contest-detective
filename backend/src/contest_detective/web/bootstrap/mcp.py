"""本地只读工具；传输、参数校验和协议生命周期交给官方 SDK。"""

from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from sqlalchemy import URL, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.config import get_database_settings
from contest_detective.framework.db import SessionLocal
from contest_detective.server.contest import service as contests
from contest_detective.server.contest.schemas import ContestQuery, ContestStatus
from contest_detective.server.user import matching
from contest_detective.server.user.schemas import Profile

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)


def create_server(*, session_factory=SessionLocal) -> FastMCP:
    server = FastMCP('比赛侦探')

    @server.tool(annotations=READ_ONLY)
    def search_contests(keyword: str | None = None, status: ContestStatus | None = None,
                        mode: Literal['online', 'offline', 'hybrid'] | None = None,
                        date_from: datetime | None = None, date_to: datetime | None = None,
                        ids: list[str] | None = None, sort: Literal['deadline', 'start'] = 'deadline',
                        page: int = 1, page_size: int = 20) -> dict[str, Any]:
        """查询本地赛事库，日期精度和来源等级保持原样。"""
        query = ContestQuery(keyword=keyword, status=status, mode=mode, date_from=date_from,
                             date_to=date_to, ids=ids, sort=sort, page=page, page_size=page_size)
        with session_factory() as session:
            items, total = contests.query(session, query)
        return {'items': [item.model_dump(mode='json') for item in items], 'total': total,
                'page': query.page, 'page_size': query.page_size}

    @server.tool(annotations=READ_ONLY)
    def get_contest(id: str) -> dict[str, Any]:
        """读取一场赛事的完整字段、核实等级和原文出处。"""
        with session_factory() as session:
            item = contests.get(session, id)
        if item is None:
            raise ValueError('比赛未找到')
        return item.model_dump(mode='json')

    @server.tool(annotations=READ_ONLY)
    def match_contests(profile: Profile) -> dict[str, Any]:
        """按显式提供的画像匹配本地赛事，不保存画像或读取账号。"""
        with session_factory() as session:
            items = matching.match(session, profile)
        return {'items': [item.model_dump(mode='json') for item in items]}

    return server


def readonly_engine(url: str):
    configured = make_url(url)
    if configured.drivername != 'sqlite' or not configured.database or configured.database == ':memory:':
        raise ValueError('只读服务需要已有的 SQLite 文件地址')
    path = Path(configured.database).expanduser().resolve()
    # mode=ro 同时阻止数据写入和缺库时自动建空库，不通过启动迁移补表。
    target = URL.create('sqlite', database='file:' + quote(str(path), safe='/'),
                        query={'mode': 'ro', 'uri': 'true'})
    return create_engine(target, connect_args={'check_same_thread': False})


def main():
    bind = readonly_engine(get_database_settings().url)
    try:
        create_server(session_factory=sessionmaker(bind=bind, expire_on_commit=False)).run(transport='stdio')
    finally:
        bind.dispose()


if __name__ == '__main__':
    main()
