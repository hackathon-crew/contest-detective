"""只重试可恢复的传输或服务错误，业务拒绝和程序错误直接传播。"""
import logging
from asyncio import sleep

import httpx
from pydantic_ai.exceptions import ModelConnectionError, ModelHTTPError, ModelQuotaExceededError

logger = logging.getLogger(__name__)
TRANSIENT_ERRORS = (ModelConnectionError, ModelHTTPError, httpx.TransportError, httpx.HTTPStatusError,
                    ConnectionError, TimeoutError)
WEB_ERRORS = (httpx.TransportError, httpx.HTTPStatusError, ConnectionError, TimeoutError)


def temporary(error):
    if isinstance(error, ModelQuotaExceededError):
        return False
    if isinstance(error, ModelHTTPError):
        return error.status_code == 429 or error.status_code >= 500
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code == 429 or error.response.status_code >= 500
    return isinstance(error, (ModelConnectionError, httpx.TransportError, ConnectionError, TimeoutError))


async def retry_transient(operation, *, errors=TRANSIENT_ERRORS):
    for attempt in range(3):
        try:
            return await operation()
        except errors as error:
            if not temporary(error) or attempt == 2:
                raise
            logger.warning('Transient request failure; retrying attempt %s', attempt + 2, exc_info=True)
            await sleep(2 ** attempt)
