"""framework 配置。

数据库用 ``DETECTIVE_DB_`` 前缀，支持 SQLite 与 PostgreSQL。
进程级配置用 ``DETECTIVE_`` 前缀。
"""

from contest_detective.framework.config.app import AppSettings, get_app_settings
from contest_detective.framework.config.database import DatabaseSettings, get_database_settings

__all__ = [
    "AppSettings",
    "DatabaseSettings",
    "get_app_settings",
    "get_database_settings",
]
