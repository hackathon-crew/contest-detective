"""SQLite 会话。表由各领域的 models 模块注册，初始化只负责建表。"""
from pathlib import Path

from alembic import command
from alembic.config import Config
from importlib import import_module
from pkgutil import walk_packages

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from contest_detective.framework.config import get_database_settings


class Base(DeclarativeBase):
    pass


engine = create_engine(get_database_settings().url, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session():
    with SessionLocal() as session:
        yield session


def load_models():
    from contest_detective import server

    for module in walk_packages(server.__path__, server.__name__ + "."):
        if module.name.endswith(".models"):
            import_module(module.name)


def init_db(bind=None):
    """在指定连接执行有版本的升级；生产不隐式补表。"""
    load_models()
    config = Config()
    config.set_main_option('script_location', str(Path(__file__).parent / 'migrations'))
    with (bind or engine).begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
