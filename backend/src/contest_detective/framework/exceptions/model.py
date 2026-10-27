"""大模型调用异常。

抽取字段或理解查询条件时，模型调用失败走这条异常。继承 :class:`BizException`，
会被 web 全局处理器按 MRO 捕获，转成 ``Response.fail``。

``provider`` / ``model`` / ``error_type`` 供内部日志与重试决策，
不直接出现在前端响应里。
"""

from contest_detective.framework.enums.biz_code import BizCode
from contest_detective.framework.enums.model import ModelErrorType
from contest_detective.framework.exceptions.biz import BizException


class ModelException(BizException):
    """大模型调用异常。"""

    def __init__(
        self,
        message: str = "模型调用失败",
        *,
        code: int = BizCode.MODEL_UNAVAILABLE,
        data: object = None,
        provider: str | None = None,
        model: str | None = None,
        error_type: ModelErrorType = ModelErrorType.UNKNOWN,
    ) -> None:
        super().__init__(message, code=code, data=data)
        self.provider = provider
        self.model = model
        self.error_type = error_type
