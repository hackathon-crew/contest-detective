"""HTTP 路由。

各模块的路由挂到这里，只做入参和响应，领域逻辑放在 ``server``。
"""

from fastapi import APIRouter

from .contests import router as contests_router
from .agent import router as agent_router

from .auth import router as auth_router
from .profile import router as profile_router
from .companion import router as companion_router

from .account_push import router as account_push_router
from .account_follows import router as account_follows_router

router = APIRouter()
router.include_router(account_push_router)
router.include_router(account_follows_router)
router.include_router(auth_router)
router.include_router(profile_router)
router.include_router(contests_router)
router.include_router(agent_router)
router.include_router(companion_router)

__all__ = ["router"]
