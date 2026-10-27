"""共享枚举。业务码与模型错误分类，不放领域模块。"""

from contest_detective.framework.enums.biz_code import BizCode
from contest_detective.framework.enums.model import ModelErrorType

__all__ = ["BizCode", "ModelErrorType"]
