"""公网只读 MCP；独立于网站的账号、迁移和来源同步生命周期。"""

from contextlib import asynccontextmanager

from mcp.server.transport_security import TransportSecuritySettings
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.orm import sessionmaker

from contest_detective.framework.config import get_database_settings
from contest_detective.web.bootstrap.mcp import create_server, readonly_engine


class MCPSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix='DETECTIVE_MCP_', env_file=('../.env', '.env'), extra='ignore',
    )

    allowed_hosts: list[str] = ['43.142.60.212', '43.142.60.212:80',
                               '127.0.0.1', '127.0.0.1:*', 'localhost', 'localhost:*']
    allowed_origins: list[str] = ['http://43.142.60.212', 'http://43.142.60.212:80',
                                 'http://127.0.0.1:*', 'http://localhost:*']


def create_app(*, database_url: str | None = None):
    settings = MCPSettings()
    bind = readonly_engine(database_url or get_database_settings().url)
    server = create_server(
        session_factory=sessionmaker(bind=bind, expire_on_commit=False),
        stateless_http=True, json_response=True, max_request_body_size=64 * 1024,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=settings.allowed_hosts, allowed_origins=settings.allowed_origins,
        ),
    )
    app = server.streamable_http_app()
    transport_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        try:
            # 缺库或未迁移的库直接启动失败，不能用空库对外提供假成功。
            with bind.connect() as connection:
                connection.exec_driver_sql('select id from contests limit 0')
            async with transport_lifespan(application):
                yield
        finally:
            bind.dispose()

    app.router.lifespan_context = lifespan
    app.state.db_engine = bind
    return app
