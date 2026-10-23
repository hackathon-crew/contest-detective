from datetime import datetime, timedelta, timezone
import re

from sqlalchemy import select

from contest_detective.server.contest import service as contests
from contest_detective.server.contest.models import Contest
from contest_detective.server.contest.schemas import DEADLINE_FIELDS, ContestSummary

from .schemas import MatchItem, Profile

BEIJING = timezone(timedelta(hours=8))
TOPIC_TERMS = {'agent': ('agent', '智能体'), 'llm': ('llm', '大模型'),
               'web3': ('web3', '区块链'), 'hardware': ('hardware', '硬件')}


def _now():
    return datetime.now(timezone.utc)


def has_preferences(profile: Profile) -> bool:
    available = profile.availability
    return bool(profile.skills or profile.topics or profile.identity_kind or profile.identity or profile.city
                or profile.preferred_modes or available.weekdays or available.windows or available.max_consecutive_days)


def _value(detail, field):
    item = detail.fields.get(field)
    return item.value if item else None


def _date(detail, field):
    value = _value(detail, field)
    return datetime.fromisoformat(value) if value else None


def _contains(text, keyword):
    key = keyword.casefold()
    return any(re.search(r'(?<![a-z0-9])' + re.escape(term) + r'(?![a-z0-9])', text)
               if term.isascii() else term in text for term in TOPIC_TERMS.get(key, (key,)))


def _required_days(text):
    text = re.sub(r'\s+', '', text)
    # Only an explicit obligation sets a minimum; optional attendance stays open.
    values = re.findall(r'(?<![无不必])(?:必须|要求|需|须)(?:至少)?连续(?:到场|驻场|参赛|参加|参与)(?:至少)?([1-9]\d?)天', text)
    return max((int(value) for value in values), default=0)


def _eligible(detail, profile, now):
    if detail.status == 'ended':
        return False
    if any((date := _date(detail, field)) is not None and date < now for field in DEADLINE_FIELDS):
        return False
    mode, city = _value(detail, 'mode'), _value(detail, 'city')
    if profile.preferred_modes and mode not in profile.preferred_modes:
        return False
    if mode in {'offline', 'hybrid'} and profile.city and city and city.removesuffix('市') != profile.city.removesuffix('市'):
        return False
    text = ' '.join((detail.name, detail.summary or '', _value(detail, 'eligibility') or '',
                     _value(detail, 'entry_requirements') or '')).casefold()
    text = re.sub(r'(?:不限|不仅限|不只限)(?:职场开发者|在校生)', '', text)
    if any(term in text for term in ('仅限职场开发者', '限职场开发者', 'professionals only', 'professional developers only')):
        if profile.identity_kind != 'professional':
            return False
    if any(term in text for term in ('仅限在校生', '限在校生', 'students only', 'college students only')):
        if profile.identity_kind != 'student':
            return False
    start, end = _date(detail, 'start_at'), _date(detail, 'end_at')
    available = profile.availability
    required_days = _required_days(text)
    if required_days:
        if available.max_consecutive_days and required_days > available.max_consecutive_days:
            return False
        if available.weekdays and not any(
                all((first + index) % 7 in available.weekdays for index in range(min(required_days, 7)))
                for first in range(7)):
            return False
    if start is not None:
        end = end or start + timedelta(days=1)
        if end <= start:
            return False
        first = start.astimezone(BEIJING).date()
        last = (end - timedelta(microseconds=1)).astimezone(BEIJING).date()
        days = (last - first).days + 1
        if available.max_consecutive_days and days > available.max_consecutive_days:
            return False
        if available.weekdays and any((first + timedelta(days=index)).weekday() not in available.weekdays
                                      for index in range(min(days, 7))):
            return False
        if available.windows and not any(window.start_at <= start and window.end_at >= end for window in available.windows):
            return False
    return True


def _rank_and_reason(detail, profile):
    text = (detail.name + ' ' + (detail.summary or '')).casefold()
    topics = [topic for topic in dict.fromkeys(profile.topics) if _contains(text, topic)]
    skills = [skill for skill in dict.fromkeys(profile.skills) if _contains(text, skill)]
    reasons = []
    for topic in topics[:2]:
        evidence = [repo for repo in profile.github_evidence if topic.casefold() in [t.casefold() for t in repo.topics]]
        if evidence:
            links = '、'.join(f'[{repo.name}]({repo.url})' for repo in evidence[:3])
            reasons.append(f'你的 {len(evidence)} 个仓库带有 {topic} topic（{links}），与这场赛道相符')
        else:
            reasons.append(f'你确认的 {topic} 兴趣与这场的主题相符')
    if skills:
        reasons.append('你确认的 ' + '、'.join(skills[:3]) + ' 技能与这场主题相关')
    mode = _value(detail, 'mode')
    if mode:
        reasons.append({'online': '线上', 'offline': '线下', 'hybrid': '线上线下结合'}[mode])
    if profile.availability.weekdays or profile.availability.windows or profile.availability.max_consecutive_days:
        if _date(detail, 'start_at'):
            reasons.append('已知比赛时间与你确认的可投入时间相符')
    if not topics and not skills:
        reasons.insert(0, '符合你确认的筛选条件，暂未找到技能或主题重合')
    return float(len(topics) * 3 + len(skills) * 2), '；'.join(reasons) + '。'


def match(session, profile: Profile) -> list[MatchItem]:
    if not has_preferences(profile):
        return []
    now = _now()
    results = []
    for contest_id in session.scalars(select(Contest.id)):
        detail = contests.get(session, contest_id)
        if not _eligible(detail, profile, now):
            continue
        score, reason = _rank_and_reason(detail, profile)
        summary = ContestSummary.model_validate(detail.model_dump())
        summary.fields = {key: value.model_copy(update={'sources': []}) for key, value in summary.fields.items()}
        results.append(MatchItem(contest=summary, score=score, reason=reason))
    results.sort(key=lambda item: (-item.score, item.contest.name, item.contest.id))
    return results[:20]
