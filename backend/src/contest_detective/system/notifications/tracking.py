from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
import re

from pydantic import BaseModel, Field
from pydantic_ai import Agent, UsageLimits
from sqlalchemy import select

from contest_detective.framework.exceptions import BizException
from contest_detective.contest import service as contests
from contest_detective.contest.models import Contest
from contest_detective.contest.schemas import DATE_FIELDS, DEADLINE_FIELDS, calendar_date, date_bounds
from contest_detective.system.account.schemas import TrackingConditions, LibraryConditions
from contest_detective.system.account.models import Follow


def deadline(contest, now):
    values = [(field, contest.fields[field]) for field in DEADLINE_FIELDS
              if field in contest.fields and contest.fields[field].value]
    future = [(field, value) for field, value in values if date_bounds(value.value, value.precision)[1] >= now]
    if future: return min(future, key=lambda item: date_bounds(item[1].value, item[1].precision)[1])
    return max(values, key=lambda item: date_bounds(item[1].value, item[1].precision)[1]) if values else None


def meaningful(conditions):
    if not any((conditions.keywords, conditions.topics, conditions.modes, conditions.city,
                conditions.has_prize, conditions.deadline_from, conditions.deadline_to,
                conditions.library and conditions.library.model_dump() != LibraryConditions().model_dump())):
        raise BizException('请写明想找的方向、地点、形式或截止时间', code=400)
    return conditions


class ParsedTracking(BaseModel):
    conditions: TrackingConditions
    unsupported: list[str] = Field(default_factory=list, max_length=20)


def create_tracking_parser(model_factory):
    async def parse(text: str, today: date):
        agent = Agent(model_factory(), output_type=ParsedTracking, retries=0,
            instructions='将想追踪的比赛拆成结构化条件，只解析，不搜索、不筛选、不计算匹配数。'
            'keywords 和 topics 内部均为 AND；online 包含可线上参加的 hybrid。'
            '时间范围只对应截止日期，按输入给出的北京时间今天解析相对日期，月份没有年份时取下一次该月份。'
            '禁止忽略限制。金额阈值、地区范围、资格等无法用 schema 表达的条件写入 unsupported，不能猜测或放宽。')
        async with agent:
            result = await agent.run(f'北京时间今天：{today.isoformat()}\n追踪条件：{text}', usage_limits=UsageLimits(request_limit=1))
        if result.output.conditions.library is not None:
            raise BizException('请写明想追踪的方向、地点、形式或截止时间', code=400)
        if result.output.unsupported:
            raise BizException('这组条件还不能表达：' + '、'.join(result.output.unsupported), code=400)
        return meaningful(result.output.conditions)
    return parse


def all_contests(session):
    return [item for key in session.scalars(select(Contest.id)) if (item := contests.get(session, key)) is not None]


def matching_contests(session, conditions, now=None, *, user_id=None):
    now = now or datetime.now(timezone.utc)
    meaningful(conditions)
    result = []
    for item in all_contests(session):
        if item.status == 'ended':
            continue
        fields = item.fields
        if conditions.library and not library_matches(session, item, conditions.library, now, user_id):
            continue
        get = lambda field: fields[field].value if field in fields else None
        mode, city = get('mode'), get('city')
        if conditions.modes and mode not in conditions.modes and not (mode == 'hybrid' and any(m in conditions.modes for m in ('online', 'offline'))):
            continue
        if conditions.city and conditions.city.casefold() not in (city or '').casefold():
            continue
        hay = ' '.join([item.name, item.summary or '', *[value.value or '' for value in fields.values()]]).casefold()
        if not all(keyword.casefold() in hay for keyword in conditions.keywords):
            continue
        aliases = {'ai': ('ai', '人工智能', '智能体', '大模型', 'llm', 'agent')}
        if not all(any(term in hay for term in aliases.get(topic.casefold(), (topic.casefold(),))) for topic in conditions.topics):
            continue
        if conditions.has_prize and not any(float(n) > 0 for n in re.findall(r'\d+(?:\.\d+)?', get('prize') or '')):
            continue
        due = deadline(item, now)
        if conditions.deadline_from or conditions.deadline_to:
            if not due:
                continue
            value = due[1]
            day = calendar_date(value.value, value.precision)
            if date_bounds(value.value, value.precision)[1] < now:
                continue
            if conditions.deadline_from and day < conditions.deadline_from:
                continue
            if conditions.deadline_to and day > conditions.deadline_to:
                continue
        result.append(item)
    return result


THEMES = {'Machine Learning/AI':'AI','Beginner Friendly':'新手友好','Social Good':'公益','Open Ended':'不限方向','Education':'教育','Design':'设计','Health':'健康','Gaming':'游戏','Blockchain':'区块链','Productivity':'效率工具','Low/No Code':'低代码','Fintech':'金融科技','Cybersecurity':'网络安全','Communication':'通信','Databases':'数据库','Enterprise':'企业服务','Music/Art':'音乐与艺术','Mobile':'移动端','Robotic Process Automation':'流程自动化','Quantum':'量子计算','E-commerce/Retail':'电商零售','Lifehacks':'生活工具'}


def library_matches(session, item, q, now, user_id):
    value = lambda field: item.fields[field].value if field in item.fields else None
    first = re.sub(r'^(?:主题|Themes?)\s*[:：]\s*', '', (item.summary or '').split('\n')[0], flags=re.I)
    themes = [THEMES.get(term.strip(), term.strip()) for term in re.split('[,，、|]', first)
              if term.strip() in THEMES or term.strip() in {'AI','Web','AR/VR','IoT','DevOps','Serverless'}]
    hay = ' '.join(str(part or '') for part in (item.name, value('organizer'), value('city'), value('venue'), *themes)).casefold()
    if q.keyword and not all(word in hay for word in q.keyword.casefold().split()): return False
    if q.status != 'all' and item.status != q.status: return False
    if q.modes and value('mode') not in q.modes: return False
    city = value('city') if value('mode') != 'online' and value('city') != '线上' else None
    if q.cities and city not in q.cities: return False
    prize = value('prize') or ''
    amounts = re.findall(r'\d[\d,]*(?:\.\d+)?', prize)
    if q.prize and (not prize.strip() or re.search('未公布|后续|待定|咨询|待公布', prize) or (amounts and all(float(n.replace(',', '')) == 0 for n in amounts))): return False
    due = deadline(item, now)
    if q.official and (due is None or due[1].level != 'official'): return False
    if q.mine and (user_id is None or session.get(Follow, (user_id, item.id)) is None): return False
    chosen = due[1] if due else item.fields.get('start_at')
    day = calendar_date(chosen.value, chosen.precision) if chosen and chosen.value else None
    if q.date and q.date != day: return False
    if q.due != 'all':
        if q.due == 'none':
            if due: return False
        else:
            left = (day-now.astimezone(ZoneInfo('Asia/Shanghai')).date()).days if due else -1
            if left < 0 or (left <= 30 if q.due == 'later' else left > int(q.due)): return False
    if q.date_from or q.date_to:
        def inside(field):
            known = item.fields.get(field)
            if known is None or not known.value: return False
            start, end = date_bounds(known.value, known.precision)
            return (q.date_from is None or end >= q.date_from) and (q.date_to is None or start <= q.date_to)
        if not any(inside(field) for field in DATE_FIELDS): return False
    return True
