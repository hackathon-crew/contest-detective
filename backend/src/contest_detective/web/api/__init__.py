"""HTTP 路由。

各模块的路由挂到这里，只做入参和响应，领域逻辑放在 ``server``。
"""

from fastapi import APIRouter

from .contests import router as contests_router
from .agent import router as agent_router

from .auth import router as auth_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(contests_router)
router.include_router(agent_router)

__all__ = ["router"]
