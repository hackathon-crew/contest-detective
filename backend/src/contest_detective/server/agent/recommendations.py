"""模型只选择比赛和撰写说明，卡片的字段与出处始终从比赛库读取。"""
import re
import unicodedata
from collections import defaultdict
from urllib.parse import urldefrag

from sqlalchemy import select
from sqlalchemy.orm import Session

from contest_detective.server.contest import service
from contest_detective.server.contest.models import ContestClaim, ContestPage, ContestPageLink
from .schemas import ContestRecommendation, RecommendationChoice, ResolveRecommendations


def materialize(session: Session, choices: list[RecommendationChoice]) -> list[ContestRecommendation]:
    items = []
    seen = set()
    for choice in choices:
        if choice.contest_id in seen:
            continue
        seen.add(choice.contest_id)
        contest = service.get(session, choice.contest_id)
        if contest is not None:
            items.append(ContestRecommendation(contest=contest, introduction=choice.introduction,
                                               reason=choice.reason))
    return items


def _text_key(value: str) -> str:
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value).casefold())


def _url_key(value: str) -> str:
    return urldefrag(value)[0].rstrip('/')


def resolve_previous(session: Session, body: ResolveRecommendations) -> list[ContestRecommendation]:
    """旧记录没有选择清单，只补正文已提到的比赛；研究来源本身不等于推荐。"""
    links = {_url_key(url) for url in re.findall(r'https?://[^\s<>()\]]+', body.content)}
    references = links | {_url_key(source.url) for source in body.sources}
    if not references:
        return []
    variants = {variant for url in references for variant in (url, url + '/')}
    rows = list(session.execute(select(ContestPageLink.contest_id, ContestPage.url).join(
        ContestPage, ContestPage.id == ContestPageLink.page_id,
    ).where(ContestPage.url.in_(variants))))
    rows.extend(session.execute(select(ContestClaim.contest_id, ContestClaim.value).where(
        ContestClaim.field == 'registration_url', ContestClaim.value.in_(variants),
    )))
    url_ids = defaultdict(set)
    for contest_id, url in rows:
        url_ids[_url_key(url)].add(contest_id)
    content = _text_key(body.content)
    positions = {}
    for url, ids in url_ids.items():
        for contest_id in ids:
            contest = service.get(session, contest_id)
            if contest is None:
                continue
            name_at = content.find(_text_key(contest.name))
            # 一个公共报名表可能服务于多场比赛，只有名称明确时才能确定是哪一场。
            url_at = content.find(_text_key(url)) if url in links and len(ids) == 1 else -1
            mentions = [position for position in (name_at, url_at) if position >= 0]
            if mentions:
                position = min(mentions)
                previous = positions.get(contest_id)
                if previous is None or position < previous[0]:
                    positions[contest_id] = (position, contest)
    return [ContestRecommendation(contest=contest, introduction=contest.summary, reason='')
            for _, contest in sorted(positions.values(), key=lambda item: item[0])]
