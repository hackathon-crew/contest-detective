"""异常：业务异常基类与大模型调用异常。"""

from contest_detective.framework.exceptions.biz import BizException
from contest_detective.framework.exceptions.model import ModelException

__all__ = ["BizException", "ModelException"]
