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
from contest_detective.framework.config.database import normalize_database_url
from contest_detective.framework.db import SessionLocal
from contest_detective.contest import service as contests
from contest_detective.contest.schemas import ContestQuery, ContestStatus
from contest_detective.system.user import matching
from contest_detective.system.user.schemas import Profile
from contest_detective.system.account.tokens import mcp_owner
from contest_detective.system.account.models import Follow, Track
from contest_detective.system.user.models import User
from sqlalchemy import select
import uuid

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)


PRIVATE_TOOLS = {'get_my_profile','get_my_follows','get_my_tracking'}


class AccountMCP(FastMCP):
    async def list_tools(self):
        tools = await super().list_tools()
        return tools if mcp_owner.get() else [tool for tool in tools if tool.name not in PRIVATE_TOOLS]


def create_server(*, session_factory=SessionLocal, private_tools=False, **transport_options) -> FastMCP:
    server = AccountMCP('比赛侦探', **transport_options)

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

    if private_tools:
        def account_id():
            key=mcp_owner.get()
            if key is None: raise ValueError('请在 MCP 配置中带上个人令牌')
            return uuid.UUID(key)

        @server.tool(annotations=READ_ONLY)
        def get_my_profile() -> dict[str, Any]:
            """读取个人令牌所属账号已确认的画像。"""
            key=account_id()
            with session_factory() as session:
                user=session.get(User,key)
                return Profile.model_validate(user.profile or {}).model_dump(mode='json')

        @server.tool(annotations=READ_ONLY)
        def get_my_follows() -> dict[str, Any]:
            """读取个人令牌所属账号关注的比赛与提醒开关。"""
            key=account_id()
            with session_factory() as session:
                items=[]
                for row in session.scalars(select(Follow).where(Follow.user_id==key)):
                    item=contests.get(session,row.contest_id)
                    if item:items.append({'contest':item.model_dump(mode='json'),'reminders':row.reminders})
                return {'items':items}

        @server.tool(annotations=READ_ONLY)
        def get_my_tracking() -> dict[str, Any]:
            """读取个人令牌所属账号的追踪条件。"""
            key=account_id()
            with session_factory() as session:
                return {'items':[{'id':row.id,'text':row.text,'conditions':row.conditions,'enabled':row.enabled}
                    for row in session.scalars(select(Track).where(Track.user_id==key))]}

    return server


def readonly_engine(url: str):
    target = normalize_database_url(url)
    configured = make_url(target)
    if configured.get_backend_name() == 'sqlite':
        if not configured.database or configured.database == ':memory:':
            raise ValueError('只读服务需要已有的 SQLite 文件地址')
        path = Path(configured.database).expanduser().resolve()
        # mode=ro 同时阻止数据写入和缺库时自动建空库，不通过启动迁移补表。
        sqlite_url = URL.create('sqlite', database='file:' + quote(str(path), safe='/'),
                                query={'mode': 'ro', 'uri': 'true'})
        return create_engine(sqlite_url, connect_args={'check_same_thread': False})
    if configured.get_backend_name() == 'postgresql':
        return create_engine(
            target,
            connect_args={
                'application_name': 'contest-detective-mcp',
                'options': '-c default_transaction_read_only=on -c timezone=UTC',
            },
        )
    raise ValueError('只读服务只支持 SQLite 或 PostgreSQL')


def main():
    bind = readonly_engine(get_database_settings().url)
    try:
        create_server(session_factory=sessionmaker(bind=bind, expire_on_commit=False)).run(transport='stdio')
    finally:
        bind.dispose()


if __name__ == '__main__':
    main()
