import json
from urllib.parse import urlparse

from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
from tencentcloud.wsa.v20250508 import models

from contest_detective.research.search.base import SearchHit


def _valid_http_url(raw: str) -> str | None:
    try:
        parsed = urlparse(raw)
        if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
            return None
        return raw
    except ValueError:
        return None


class YuanbaoSearch:
    def __init__(self, *, secret_id: str, secret_key: str, client=None):
        self._secret_id = secret_id
        self._secret_key = secret_key
        self._client = client

    def _sdk(self):
        if self._client is not None:
            return self._client
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.wsa.v20250508 import wsa_client

        cred = credential.Credential(self._secret_id, self._secret_key)
        http = HttpProfile(endpoint='wsa.tencentcloudapi.com', reqTimeout=10)
        return wsa_client.WsaClient(cred, '', ClientProfile(httpProfile=http))

    def search(self, query: str, *, site: str | None = None, count: int = 10) -> list[SearchHit]:
        if not 1 <= count <= 50:
            raise ValueError('搜索条数必须在 1 到 50 之间')
        if not self._secret_id or not self._secret_key:
            return []
        request = models.SearchProRequest()
        request.Query = query
        request.Cnt = ((count + 9) // 10) * 10
        if site:
            request.Site = site
        try:
            payload = self._sdk().SearchPro(request)
        except TencentCloudSDKException as exc:
            raise ValueError('搜索服务暂不可用') from exc
        hits = []
        for raw in payload.Pages or []:
            try:
                page = json.loads(raw) if isinstance(raw, str) else raw
                url = _valid_http_url(page['url'])
                if url is None:
                    continue
                host = urlparse(url).hostname or url
                hits.append(SearchHit(
                    title=page.get('title') or url, url=url,
                    site=page.get('site') or host, date=page.get('date') or None,
                    snippet=page.get('passage') or page.get('content') or '', provider='yuanbao',
                ))
            except (ValueError, TypeError, KeyError):
                continue
        return hits[:count]
