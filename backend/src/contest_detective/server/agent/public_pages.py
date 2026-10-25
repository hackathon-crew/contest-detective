"""Use the existing pinned-IP/redirect-safe fetcher and retain final provenance."""
from urllib.parse import urlsplit
from contest_detective.server.research_pipeline.pages import fetch_page
from .verification import safe_evidence_url, scope_check


def fetch_public_evidence(url, *, preferences=None, client=None, resolver=None):
    def check(target):
        if not safe_evidence_url(target):
            raise ValueError('链接不能作为公开证据')
        if scope_check(target, require_contest=False).outcome != 'allowed_contest':
            raise ValueError('链接超出公开赛事核验范围')
        host = (urlsplit(target).hostname or '').lower().rstrip('.')
        if preferences and any(host == domain or host.endswith('.' + domain) for domain in preferences.blocked_domains):
            raise ValueError('重定向网站已在搜索偏好中屏蔽')
    resolved = []
    check(url)
    text = fetch_page(url, before_request=check, resolved_url=resolved, client=client, resolver=resolver)
    return {'text': text, 'url': resolved[-1] if resolved else url}
