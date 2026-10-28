"""查证中断时只使用实际读过的资料；模型指令不进入用户回答。"""
from datetime import datetime
from urllib.parse import quote

from contest_detective.contest.schemas import BEIJING, DATE_FIELDS

from .verification import markdown_text

FAILED_ANSWER = '这次没能完成查证，暂时无法给出结论。'
FIELD_NAMES = {
    'start_at': '开始日期', 'end_at': '结束日期', 'registration_deadline': '报名截止',
    'submission_deadline': '作品提交截止', 'deadline_unspecified': '截止日期（原文未说明类型）',
    'city': '城市', 'mode': '参赛形式', 'prize': '奖金', 'registration_url': '报名入口',
    'organizer': '主办方', 'venue': '地点', 'eligibility': '参赛资格', 'team_size': '队伍人数',
    'entry_fee': '参赛费用', 'entry_requirements': '参赛要求', 'judging_criteria': '评审规则',
    'past_statistics': '往届情况',
}

def link(title, url):
    return f'[{markdown_text(title)}]({quote(url, safe=":/?&=#%+;,@~.-_")})'


def interrupted_answer(deps):
    paragraphs = []
    for contest in deps.read_contests.values():
        facts = []
        for field, value in contest['fields'].items():
            sources = [source for source in value['sources'] if source['url'] in deps.sources]
            if value['value'] is None or not sources:
                continue
            text = value['value']
            if field == 'mode':
                text = {'online': '线上', 'offline': '线下', 'hybrid': '线上及线下'}.get(text, text)
            if field in DATE_FIELDS:
                text = (text[:10] if value['precision'] == 'day' else
                        datetime.fromisoformat(text.replace('Z', '+00:00')).astimezone(BEIJING).strftime('%Y-%m-%d %H:%M（北京时间）'))
            level = {'official': '官方资料', 'reposted': '转载资料', 'conflict': '来源有分歧', 'not_found': '尚未核实'}[value['level']]
            source = sources[0]
            if source.get('stale'):
                level += '，可能已过期'
            facts.append(f'{FIELD_NAMES[field]}：{markdown_text(text)}（{level}，{link(source["title"], source["url"])}）')
        if facts:
            paragraphs.append(f'已读到「{markdown_text(contest["name"])}」的资料：' + '；'.join(facts) + '。')
        else:
            paragraphs.append(f'已找到「{markdown_text(contest["name"])}」的记录，但读到的资料还不足以核实参赛信息。')
    for url, text in deps.fetched_pages.items():
        source = deps.sources.get(url)
        if source and text.strip():
            excerpt = text.strip()[:280]
            paragraphs.append(f'已读取{link(source.title, url)}，原文写道：“{markdown_text(excerpt)}”' +
                              ('（节选）' if len(text.strip()) > 280 else '') + '。这段原文尚未完成逐项核对。')
    candidates = [item['name'] for key, item in deps.observed_contests.items() if key not in deps.read_contests]
    if candidates:
        paragraphs.append('比赛库中找到了' + '、'.join(f'「{markdown_text(name)}」' for name in candidates[:5]) +
                          '等候选，还没有读取它们的具体参赛规则。')
    unread = [link(source['title'], url) for url, source in deps.search_results.items()
              if url not in deps.opened_urls and url not in deps.sources
              and (not deps.verification or url not in deps.verification.rejected_urls)]
    if unread:
        paragraphs.append('还找到以下线索，尚未读取原文，不能据此确认内容：\n' + '\n'.join(f'- {item}（未读取原文）' for item in unread[:5]))
    if not paragraphs:
        return None
    paragraphs.append('这次查证还没有完成，其余信息仍未核实。')
    return '\n\n'.join(paragraphs)
