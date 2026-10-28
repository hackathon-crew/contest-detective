"""数据库会话。表由各领域的 models 模块注册，初始化只负责执行迁移。"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from importlib import import_module
from pkgutil import walk_packages

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

import contest_detective

from contest_detective.framework.config import DatabaseSettings, get_database_settings
from contest_detective.framework.config.database import normalize_database_url


class Base(DeclarativeBase):
    pass


def create_db_engine(url: str | None = None, settings: DatabaseSettings | None = None) -> Engine:
    """Build an engine without connecting; SQLite keeps its single-file settings."""
    settings = settings or get_database_settings()
    target = normalize_database_url(url or settings.url)
    parsed = make_url(target)
    if parsed.get_backend_name() == "sqlite":
        return create_engine(target, echo=settings.echo, connect_args={"check_same_thread": False})
    return create_engine(
        target,
        echo=settings.echo,
        pool_pre_ping=True,
        pool_size=settings.pool_size,
        max_overflow=settings.max_overflow,
        pool_timeout=settings.pool_timeout,
        pool_recycle=settings.pool_recycle,
        connect_args={"application_name": "contest-detective", "options": "-c timezone=UTC"},
    )


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def lock_for_write(session, model):
    """在当前事务里串行化对一张表的写入，锁到提交或回滚为止。

    SQLite 只能锁整个库，用 BEGIN IMMEDIATE，调用前事务必须还没开始；
    PostgreSQL 只锁这张表，用 EXCLUSIVE 模式，别的写入会排队，普通查询不受影响。
    """
    if session.get_bind().dialect.name == 'sqlite':
        session.execute(text('BEGIN IMMEDIATE'))
    else:
        session.execute(text(f'LOCK TABLE {model.__tablename__} IN EXCLUSIVE MODE'))


def get_session():
    with SessionLocal() as session:
        yield session


def load_models():
    # Walk the package tree so a new domain package registers its tables without being listed here.
    for found in walk_packages(contest_detective.__path__, contest_detective.__name__ + '.'):
        if found.name.endswith('.models'):
            import_module(found.name)


def init_db(bind=None):
    """在指定连接执行有版本的升级；生产不隐式补表。"""
    load_models()
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).parent / 'migrations'))
    with (bind or engine).begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
