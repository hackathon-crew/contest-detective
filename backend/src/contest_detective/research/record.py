"""只保存正文原文支持的字段，网页身份和官方等级由调用上下文确定。"""

import asyncio
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from contest_detective.framework.db import SessionLocal
from contest_detective.contest import service as contests
from contest_detective.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.contest.content import ContentCoverage, ContestDocument
from contest_detective.contest.content_service import build_introduction
from contest_detective.research.detail import document_for
from contest_detective.research.official import is_official_page
from contest_detective.research.pages import fetch_page

Extractor = Callable[[str, str], Awaitable[ContestDraft]]


def _normalized(text: str) -> str:
    return ' '.join(text.split())


async def run(url: str, *, extractor: Extractor, session_factory=SessionLocal,
              page_text: str | None = None, registration_url: str | None = None,
              contest_id: str | None = None, document: ContestDocument | None = None) -> str | None:
    parsed = urlsplit(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('只支持 HTTP(S) 网页')
    text = (page_text if page_text is not None else await asyncio.to_thread(fetch_page, url))
    if not text.strip():
        return None
    draft = ContestDraft.model_validate(await extractor(url, text))
    body = _normalized(text)
    claims = [claim for claim in draft.claims
              if _normalized(claim.excerpt) and _normalized(claim.excerpt) in body]
    if not claims:
        return None
    name = draft.name.strip()
    if not name:
        raise ValueError('赛事名称不能为空')
    checked = draft.model_copy(update={
        'name': name,
        'page': PageIn(url=url, site=parsed.hostname, title=name,
                       is_official=is_official_page(url, registration_url=registration_url)),
        'claims': claims,
    })
    document = document or document_for(checked.page, text,
        fetch_method='http' if page_text is None else 'cached_web_excerpt',
        completeness='full' if page_text is None else 'partial')
    document = document.model_copy(update=checked.page.model_dump())
    checked = checked.model_copy(update={'documents': [document],
        'introduction': build_introduction(document), 'coverage': ContentCoverage(), 'themes': None})
    with session_factory() as session:
        matched_id = contest_id or contests.match_id(session, checked)
        if matched_id is not None:
            # 漏抽不等于事实消失；只保留本页当前正文仍支持、且本轮未更新的字段。
            fresh = {(claim.field, claim.value, claim.precision, _normalized(claim.excerpt))
                     for claim in checked.claims}
            carried = [
                ClaimIn(field=field, value=source.value, excerpt=source.excerpt, precision=source.precision)
                for field, source in contests.claim_sources(session, matched_id)
                if source.url == url
                and (field, source.value, source.precision, _normalized(source.excerpt)) not in fresh
                and (excerpt := _normalized(source.excerpt)) and excerpt in body
            ]
            checked = checked.model_copy(update={'claims': [*carried, *checked.claims]})
        return contests.save(session, checked, contest_id=matched_id)
