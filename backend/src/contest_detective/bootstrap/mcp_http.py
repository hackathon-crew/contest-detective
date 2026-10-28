"""公网只读 MCP；独立于网站的账号、迁移和来源同步生命周期。"""

from contextlib import asynccontextmanager

from mcp.server.transport_security import TransportSecuritySettings
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.orm import sessionmaker
from starlette.responses import JSONResponse
from contest_detective.system.account.tokens import mcp_owner,resolve_token

from contest_detective.framework.config import get_database_settings
from contest_detective.framework.db import create_db_engine
from contest_detective.bootstrap.mcp import create_server, readonly_engine


class MCPSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix='DETECTIVE_MCP_', env_file=('../.env', '.env'), extra='ignore',
    )

    allowed_hosts: list[str] = ['43.142.60.212', '43.142.60.212:80',
                               '127.0.0.1', '127.0.0.1:*', 'localhost', 'localhost:*']
    allowed_origins: list[str] = ['http://43.142.60.212', 'http://43.142.60.212:80',
                                 'http://127.0.0.1:*', 'http://localhost:*']



class PersonalTokenMiddleware:
    def __init__(self,app,session_factory):self.app,self.session_factory=app,session_factory

    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        raw=dict(scope.get('headers',[])).get(b'authorization',b'').decode(errors='replace')
        identity=None
        if raw:
            if not raw.startswith('Bearer ') or len(raw)>120:
                return await JSONResponse({'error':'个人令牌无效'},status_code=401)(scope,receive,send)
            with self.session_factory() as session:
                user=resolve_token(session,raw[7:],touch=True)
                if user:identity=str(user.id)
            if identity is None:return await JSONResponse({'error':'个人令牌无效'},status_code=401)(scope,receive,send)
        token=mcp_owner.set(identity)
        try:await self.app(scope,receive,send)
        finally:mcp_owner.reset(token)

def create_app(*, database_url: str | None = None):
    settings = MCPSettings()
    url=database_url or get_database_settings().url
    bind = readonly_engine(url)
    auth_bind = create_db_engine(url)
    server = create_server(
        session_factory=sessionmaker(bind=bind, expire_on_commit=False),
        private_tools=True, stateless_http=True, json_response=True, max_request_body_size=64 * 1024,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=settings.allowed_hosts, allowed_origins=settings.allowed_origins,
        ),
    )
    app = server.streamable_http_app()
    app.add_middleware(PersonalTokenMiddleware,session_factory=sessionmaker(bind=auth_bind,expire_on_commit=False))
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
            auth_bind.dispose()

    app.router.lifespan_context = lifespan
    app.state.db_engine = bind
    return app
