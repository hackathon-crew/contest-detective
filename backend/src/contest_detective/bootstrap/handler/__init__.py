"""全局异常处理。"""

from contest_detective.bootstrap.handler.exception_handlers import SensitiveRoute, register_exception_handlers

__all__ = ["SensitiveRoute", "register_exception_handlers"]
