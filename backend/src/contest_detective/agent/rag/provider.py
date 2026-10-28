"""The single supported embedding endpoint and model; credentials stay in env files."""
import math

import httpx
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

MODEL = 'BAAI/bge-m3'
DIMENSIONS = 1024


class RagSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='DETECTIVE_RAG_', env_file=('../.env', '.env'), extra='ignore')
    api_key: SecretStr = SecretStr('')


def validate_vector(value) -> list[float]:
    if not isinstance(value, list) or len(value) != DIMENSIONS:
        raise ValueError('Embedding must have 1024 dimensions')
    vector = [float(item) for item in value]
    if not all(math.isfinite(item) for item in vector) or not any(vector):
        raise ValueError('Embedding must be finite and nonzero')
    return vector


class SiliconFlowEmbedding:
    def __init__(self, api_key: str, *, client: httpx.Client | None = None):
        self._api_key = api_key
        self._client = client

    def embed(self, text: str) -> list[float]:
        def request(client):
            response = client.post('https://api.siliconflow.cn/v1/embeddings',
                headers={'Authorization': f'Bearer {self._api_key}'},
                json={'model': MODEL, 'input': text, 'encoding_format': 'float'})
            response.raise_for_status()
            try:
                return validate_vector(response.json()['data'][0]['embedding'])
            except (KeyError, IndexError, TypeError) as error:
                raise ValueError('Invalid embedding response') from error

        if not text.strip():
            raise ValueError('Embedding input must not be empty')
        if self._client is not None:
            return request(self._client)
        with httpx.Client(timeout=10) as client:
            return request(client)


def configured_provider():
    key = RagSettings().api_key.get_secret_value()
    return SiliconFlowEmbedding(key) if key else None
