"""异常：业务异常基类与大模型调用异常。"""

from contest_detective.common.exceptions.biz import BizException
from contest_detective.common.exceptions.model import ModelException

__all__ = ["BizException", "ModelException"]
