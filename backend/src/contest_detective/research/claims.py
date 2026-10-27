"""模型输出按字段解析，一条无效的可选字段不丢弃其余事实。"""

import logging
from typing import Annotated

from pydantic import BeforeValidator, ValidationError

from contest_detective.contest.schemas import ClaimIn

logger = logging.getLogger(__name__)


def _valid_claims(value):
    if not isinstance(value, list):
        return value
    valid = []
    for item in value:
        try:
            valid.append(ClaimIn.model_validate(item))
        except ValidationError:
            continue
    # 全部无效时仍交给输出校验触发纠正，不能伪装成查无资料。
    if not valid:
        return value
    if len(valid) != len(value):
        logger.warning('Skipped invalid extracted claims count=%s', len(value) - len(valid))
    return valid


ExtractedClaims = Annotated[list[ClaimIn], BeforeValidator(_valid_claims)]
