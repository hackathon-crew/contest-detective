"""模型调用失败的分类。

只给日志和重试决策用，不放进前端响应体。
"""

from enum import Enum


class ModelErrorType(str, Enum):
    """模型调用失败时的错误种类。"""

    TIMEOUT = "timeout"
    RATE_LIMIT = "rate_limit"
    UNAVAILABLE = "unavailable"
    INVALID_OUTPUT = "invalid_output"
    UNKNOWN = "unknown"
