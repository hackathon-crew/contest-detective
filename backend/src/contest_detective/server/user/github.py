import asyncio
from collections import Counter
from contextlib import asynccontextmanager

import httpx
from pydantic import TypeAdapter, ValidationError

from contest_detective.common.exceptions import BizException
from contest_detective.framework.config.profile import get_profile_settings

from .schemas import GitHubEvidence, GitHubUsername, Profile


async def build_github_profile(username: str, *, client=None, token=None) -> Profile:
    username = TypeAdapter(GitHubUsername).validate_python(username)
    if token is None:
        secret = get_profile_settings().github_token
        token = secret.get_secret_value() if secret else None
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
               'User-Agent': 'ContestDetective/0.1'}
    if token:
        headers['Authorization'] = 'Bearer ' + token

    @asynccontextmanager
    async def active_client():
        if client is not None:
            yield client
        else:
            async with httpx.AsyncClient(timeout=4, follow_redirects=False) as created:
                yield created

    try:
        async with asyncio.timeout(8), active_client() as active:
            user = await active.get(f'https://api.github.com/users/{username}', headers=headers)
            user.raise_for_status()
            repos = await active.get(f'https://api.github.com/users/{username}/repos',
                params={'per_page': 100, 'sort': 'pushed'}, headers=headers)
            repos.raise_for_status()
        records = repos.json()
        if not isinstance(records, list):
            raise ValueError('invalid repository response')
        evidence = [GitHubEvidence(name=item['name'], url=item['html_url'], language=item.get('language'),
                    topics=item.get('topics') or [], pushed_at=item.get('pushed_at')) for item in records[:100]]
        languages = Counter(item.language for item in evidence if item.language)
        total = sum(languages.values())
        return Profile(github=user.json()['login'], skills=list(languages)[:50],
            topics=list(dict.fromkeys(topic for item in evidence for topic in item.topics))[:50],
            github_evidence=evidence, language_repo_share={language: count / total for language, count in languages.items()},
            github_last_active_at=max((item.pushed_at for item in evidence if item.pushed_at), default=None))
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        if status == 404:
            raise BizException('GitHub 用户不存在', code=404) from None
        if status in {403, 429}:
            raise BizException('GitHub 请求过于频繁，请稍后重试', code=429) from None
        raise BizException('GitHub 资料暂时不可用', code=502) from None
    except (httpx.HTTPError, TimeoutError, ValueError, KeyError, ValidationError):
        raise BizException('GitHub 资料暂时不可用', code=502) from None
