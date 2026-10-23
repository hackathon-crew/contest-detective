"""HTTP 路由。

各模块的路由挂到这里，只做入参和响应，领域逻辑放在 ``server``。
"""

from fastapi import APIRouter

router = APIRouter()

__all__ = ["router"]
