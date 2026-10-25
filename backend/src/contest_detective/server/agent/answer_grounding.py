"""Bounded, offline checks for explicit deadline assertions in generated prose.

This is not a general natural-language fact checker. It recognizes numeric,
Chinese and English-month dates, clock times and common explicit timezones.
Evidence stays scoped to a contest and deadline kind. A day-precision value's
serialized midnight is never evidence of a clock time. Unsupported/ambiguous
assertions produce retry feedback, rather than being silently rewritten.
"""
import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

from contest_detective.server.contest.schemas import BEIJING, DEADLINE_FIELDS


_MONTHS = {name: i for i, name in enumerate(
    ('jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'), 1)}
_MONTH = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
_DATE = re.compile(
    rf'(?<!\d)(?:\d{{4}}[-/.]\d{{1,2}}[-/.]\d{{1,2}}|'
    rf'(?:\d{{4}}\s*年\s*)?\d{{1,2}}\s*月\s*\d{{1,2}}\s*[日号號]|'
    rf'{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?|'
    rf'\d{{1,2}}\s+{_MONTH}(?:\s+\d{{4}})?)(?!\d)', re.I)
_TIME = re.compile(
    r'(?<![\d:：+-])(?:\d{1,2}[:：]\d{2}(?:[:：]\d{2})?(?:\s*[ap]\.?m\.?)?|'
    r'\d{1,2}\s*[ap]\.?m\.?|\d{1,2}[点时時](?:\d{1,2}分?)?)(?!\d)', re.I)
_ZONE = re.compile(
    r'北京时间|北京時間|Asia/Shanghai|(?:UTC|GMT)(?:\s*[+-]\d{1,2}(?::?\d{2})?)?|'
    r'(?<![A-Za-z])(?:PST|PDT|EST|EDT|CST|CEST|CET|Z|(?-i:[A-Z]{2,5}))(?![A-Za-z])|[+-]\d{2}:?\d{2}', re.I)
_OFFSETS = {'utc': 0, 'gmt': 0, 'z': 0, 'pst': -8, 'pdt': -7, 'est': -5, 'edt': -4,
            'cet': 1, 'cest': 2, '北京时间': 8, '北京時間': 8, 'asia/shanghai': 8}
_REGISTRATION = re.compile(r'报名|報名|注册|註冊|registration|register|sign[ -]?up', re.I)
_SUBMISSION = re.compile(r'提交|交稿|交作品|submission|submit|entry deadline|entries close', re.I)
_DEADLINE = re.compile(r'截止|截至|最晚|最迟|deadline|due|closes?|closing|\bby\b|last day', re.I)
_UNCERTAIN = re.compile(r'未核实|未核實|未确认|未確認|无法确认|無法確認|未找到|未知|不确定|待核实|尚无证据|'
                        r'unverified|unconfirmed|uncertain|unknown|not (?:yet )?(?:confirmed|verified|found)', re.I)
_TIME_UNCERTAIN = re.compile(r'(?:时刻|時刻|具体时间|具体時間|时间|時間)\s*(?:尚)?(?:未|无法|待)|'
                             r'(?:clock|time)\s+(?:is\s+)?(?:unverified|unknown|unconfirmed)', re.I)
_QUESTION = re.compile(r'是否|是不是|吗|嗎|[?？]|\b(?:is|was|does|when)\b.*\?', re.I)
_GENERIC_WORDS = {'hackathon', 'challenge', 'contest', 'competition', 'online', 'global',
                  'with', 'build', 'deadline', 'unknown', 'official'}
_LABELS = {'registration_deadline': '报名截止', 'submission_deadline': '作品提交截止',
           'deadline_unspecified': '截止（未注明类型）', 'ambiguous': '截止类型不明确'}


@dataclass(frozen=True)
class Moment:
    text: str
    year: int | None = None
    month: int | None = None
    day: int | None = None
    hour: int | None = None
    minute: int = 0
    second: int | None = None
    zone: timezone | None = None
    invalid_zone: bool = False


@dataclass(frozen=True)
class Claim:
    contests: tuple[str, ...]
    kind: str
    moment: Moment


@dataclass(frozen=True)
class Fact:
    value: datetime
    precision: str


def _plain(value):
    return value.model_dump(mode='json') if hasattr(value, 'model_dump') else value


def _kind(text):
    if not _DEADLINE.search(text):
        return None
    registration, submission = bool(_REGISTRATION.search(text)), bool(_SUBMISSION.search(text))
    if registration and submission:
        return 'ambiguous'
    return ('registration_deadline' if registration else
            'submission_deadline' if submission else 'deadline_unspecified')


def _date_parts(text):
    numbers = [int(part) for part in re.findall(r'\d+', text)]
    month = re.search(_MONTH, text, re.I)
    if month:
        return (numbers[1] if len(numbers) > 1 else None, _MONTHS[month[0][:3].lower()], numbers[0])
    return tuple(numbers) if len(numbers) == 3 else (None, *numbers)


def _clock_parts(text, prefix):
    parts = [int(part) for part in re.findall(r'\d+', text)]
    hour, minute, second = parts[0], parts[1] if len(parts) > 1 else 0, parts[2] if len(parts) > 2 else None
    if re.search(r'[ap]\.?m', text, re.I):
        hour = hour % 12 + (12 if re.search(r'p\.?m', text, re.I) else 0)
    elif re.search(r'下午|晚上|傍晚', prefix):
        hour = hour % 12 + 12
    elif re.search(r'上午|凌晨', prefix):
        hour %= 12
    return hour, minute, second


def _zone(text, start, end):
    # Prefer a suffix directly following this clock; otherwise inspect its local
    # prefix. In particular, do not borrow a later ISO conversion's timezone.
    suffix = text[end:]
    after = _ZONE.match(re.sub(r'^[\s（(]+', '', suffix))
    prefix = text[max(0, start - 25):start]
    before = [match for match in _ZONE.finditer(prefix)
              if re.fullmatch(r'[\s:：（()）]*(?:(?:当地|當地)?(?:时间|時間|时区|時區)\s*)?', prefix[match.end():])]
    token = after[0] if after else before[-1][0] if before else None
    if token is None:
        return None, False
    token = token.lower().replace(' ', '')
    if token in _OFFSETS:
        return timezone(timedelta(hours=_OFFSETS[token])), False
    offset = re.fullmatch(r'(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?', token)
    if offset:
        minutes = int(offset[2]) * 60 + int(offset[3] or 0)
        if minutes < 24 * 60 and int(offset[3] or 0) < 60:
            return timezone(timedelta(minutes=minutes * (1 if offset[1] == '+' else -1))), False
    # CST is intentionally ambiguous, rather than silently selecting China or US.
    return None, True


def _moments(text):
    # Link targets identify evidence, not temporal assertions. Keep positions so
    # surrounding labels and visible Markdown link text retain their meaning.
    text = re.sub(r'https?://[^\s<>）)]+', lambda match: ' ' * len(match[0]), text)
    occupied = []
    for date_match in _DATE.finditer(text):
        start, end = date_match.span()
        year, month, day = _date_parts(date_match[0])
        clock = _TIME.search(text, end)
        hour, minute, second = None, 0, None
        if clock and re.fullmatch(r'[\sTt@]*(?:(?:at|上午|下午|晚上|凌晨|北京时间)\s*)?', text[end:clock.start()], re.I):
            hour, minute, second = _clock_parts(clock[0], text[end:clock.start()])
            end = clock.end()
        zone, invalid_zone = _zone(text, start, end)
        occupied.append((start, end))
        yield Moment(text[start:end], year, month, day, hour, minute, second, zone, invalid_zone)
    for clock in _TIME.finditer(text):
        if any(start <= clock.start() < end for start, end in occupied):
            continue
        # A numeric UTC offset is not a second clock assertion.
        if re.search(r'(?:UTC|GMT|[+-])\s*$', text[max(0, clock.start() - 4):clock.start()], re.I):
            continue
        hour, minute, second = _clock_parts(clock[0], text[max(0, clock.start() - 3):clock.start()])
        zone, invalid_zone = _zone(text, clock.start(), clock.end())
        yield Moment(clock[0], hour=hour, minute=minute, second=second, zone=zone, invalid_zone=invalid_zone)


def _aliases(records):
    tokens = {key: set(re.findall(r'[A-Za-z][A-Za-z0-9_-]{3,}', item['name'].lower())) - _GENERIC_WORDS
              for key, item in records.items()}
    counts = Counter(token for words in tokens.values() for token in words)
    aliases = {}
    for key, item in records.items():
        names = [item['name'].lower(), *[word for word in tokens[key] if counts[word] == 1]]
        names.extend(source['url'].lower().rstrip('/') for field in item.get('fields', {}).values()
                     for source in field.get('sources', []) if source.get('url'))
        aliases[key] = names
    return aliases


def _identities(text, aliases):
    lowered = text.lower()
    return tuple(key for key, names in aliases.items() if any(
        re.search(r'(?<![a-z0-9])' + re.escape(name) + r'(?![a-z0-9])', lowered) for name in names))


def _claims(content, records, default=()):
    aliases = _aliases(records)
    context = default or (tuple(records) if len(records) == 1 else ())
    header_kind = None
    for line in content.splitlines():
        # A standalone as-of prefix timestamps the answer, not an event deadline.
        line = re.sub(r'^\s*截至\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*[，,]', '', line)
        names = _identities(line, aliases)
        if names:
            context = names
        elif re.match(r'^\s*(?:#{1,6}\s|\d+[.)]\s)', line):
            context, header_kind = (), None
        line_kind = _kind(line)
        if not list(_moments(line)) and line_kind and (line.rstrip().endswith((':', '：', '|'))):
            header_kind = line_kind
        clauses = re.findall(r'[^，；;。！？?]+[，；;。！？?]?', line)
        prior_kind = None
        for index, clause in enumerate(clauses):
            if index and clauses[index - 1].endswith(('。', '！', '？', '?')):
                prior_kind = None
            identities = _identities(clause, aliases) or context
            kind = _kind(clause) or prior_kind or header_kind
            if _kind(clause):
                prior_kind = _kind(clause)
            if not kind or _QUESTION.search(clause):
                continue
            # A following qualifier can clarify this date, but a different
            # field's "not found" cannot exempt an affirmative assertion.
            qualifier = clauses[index + 1] if index + 1 < len(clauses) else ''
            if _UNCERTAIN.search(qualifier) and not _DEADLINE.search(qualifier) and not list(_moments(qualifier)):
                clause += qualifier
            uncertain = bool(_UNCERTAIN.search(clause))
            time_only_uncertain = bool(_TIME_UNCERTAIN.search(clause))
            if uncertain and not time_only_uncertain and kind != 'ambiguous':
                continue
            for moment in _moments(clause):
                if time_only_uncertain:
                    if moment.day is None:
                        continue
                    moment = replace(moment, hour=None, zone=None, invalid_zone=False)
                yield Claim(identities, kind, moment)


def _same(moment, fact):
    if moment.invalid_zone:
        return False
    value = fact.value
    if fact.precision == 'day':
        return (moment.hour is None and moment.zone is None and moment.month == value.month
                and moment.day == value.day and moment.year in (None, value.year))
    local = value.astimezone(moment.zone or BEIJING)
    if moment.month is not None and (moment.month, moment.day) != (local.month, local.day):
        return False
    if moment.year is not None and moment.year != local.year:
        return False
    return moment.hour is None or ((moment.hour, moment.minute) == (local.hour, local.minute)
                                   and moment.second in (None, local.second))


def _facts(records, fetched_pages):
    result = {key: {kind: [] for kind in DEADLINE_FIELDS} for key in records}
    owners = {}
    for key, item in records.items():
        for kind, value in item.get('fields', {}).items():
            for source in value.get('sources', []):
                if source.get('url'):
                    owners.setdefault(source['url'].rstrip('/'), set()).add(key)
            if kind not in DEADLINE_FIELDS or not value.get('value') or value.get('level') in {'not_found', 'conflict'}:
                continue
            try:
                moment = datetime.fromisoformat(value['value'])
                if moment.tzinfo is not None:
                    result[key][kind].append(Fact(moment, value.get('precision', 'datetime')))
            except (TypeError, ValueError):
                continue
    for url, text in fetched_pages.items():
        linked = tuple(sorted(owners.get(url.rstrip('/'), ())))
        if not linked or not isinstance(text, str):
            continue
        for claim in _claims(text, records, default=linked):
            value = claim.moment
            if len(claim.contests) != 1 or claim.contests[0] not in linked or claim.kind not in DEADLINE_FIELDS:
                continue
            if value.year is None or value.day is None or value.invalid_zone or (value.hour is not None and value.zone is None):
                continue
            try:
                moment = datetime(value.year, value.month, value.day, value.hour or 0, value.minute, value.second or 0,
                                  tzinfo=value.zone or timezone.utc)
            except ValueError:
                continue
            result[claim.contests[0]][claim.kind].append(Fact(moment, 'datetime' if value.hour is not None else 'day'))
    return result


def check_answer_precision(content: str, observed_contests: Mapping, fetched_pages: Mapping[str, str]) -> list[str]:
    """Return corrective feedback from actual tool snapshots, without IO.

    For recommendation fragments, pass only the selected contest snapshot (or
    prefix its name). Fetched evidence is eligible only on an actually observed
    source URL, with a concrete date, deadline kind and, for clocks, timezone.
    A generic fetched "Deadline" never becomes registration/submission proof.
    """
    records = {key: _plain(value) for key, value in observed_contests.items()}
    facts = _facts(records, fetched_pages)
    errors = []
    for claim in _claims(content, records):
        name = '未明确对应比赛'
        supported = False
        if len(claim.contests) == 1:
            key = claim.contests[0]
            name = records[key]['name']
            kinds = DEADLINE_FIELDS if claim.kind == 'deadline_unspecified' else (claim.kind,)
            supported = any(_same(claim.moment, fact) for kind in kinds for fact in facts[key].get(kind, []))
        if not supported:
            errors.append(f'{name}：{_LABELS[claim.kind]}“{claim.moment.text}”缺少与该比赛、截止类型、日期和时区匹配的已读取证据。'
                          '请保留已核实的日期精度；day 不支持具体时刻，缺失或冲突处明确写未核实，不借用其他比赛或截止类型。')
    return list(dict.fromkeys(errors))[:12]


def _without_disputed_moments(content):
    """Remove only explicitly negated/disputed numbers, not their replacements."""
    clauses = re.split(r'([，,；;。\n])', content)
    for index in range(0, len(clauses), 2):
        clause = clauses[index]
        spans = []
        cursor = 0
        for moment in _moments(clause):
            start = clause.find(moment.text, cursor)
            if start < 0:
                continue
            end = start + len(moment.text)
            cursor = end
            prefix, suffix = clause[:start], clause[end:]
            negative = list(re.finditer(r'不是|并非|不应为|不(?:为|在)|\bnot\b|isn.t|wasn.t', prefix, re.I))
            replacement = list(re.finditer(r'而是|实际|正确|\binstead\b|\bbut\b', prefix, re.I))
            adjacent = bool(negative and re.fullmatch(r"[\s‘’“\"'（(]*(?:(?:在|on|at)\s*)?[\s‘’“\"'（(]*", prefix[negative[-1].end():], re.I))
            negated = bool(adjacent and (not replacement or negative[-1].start() > replacement[-1].start()))
            disputed = bool(re.match(r'\s*(?:与.{0,20}不符|不正确|是错误|无依据|未获支持|is (?:false|wrong|incorrect))', suffix, re.I))
            if negated or disputed:
                spans.append((start, end))
        for start, end in reversed(spans):
            clause = clause[:start] + (' ' * (end - start)) + clause[end:]
        clauses[index] = clause
    return ''.join(clauses)


def check_evidence_precision(content: str, excerpts: list[str]) -> list[str]:
    """A report comparison may quote source precision without a saved contest ID.

    Restrict evidence to this claim's actual fetched excerpts. This deliberately
    does not borrow dates from the user claim or other report claims. Without a
    complete dated timezone, retain the original precision instead of converting.
    """
    evidence = [claim for excerpt in excerpts for claim in _claims(_without_disputed_moments(excerpt), {})]
    for claim in _claims(_without_disputed_moments(content), {}):
        supported = False
        for source in evidence:
            if source.kind == 'ambiguous' or claim.kind not in {source.kind, 'deadline_unspecified'}:
                continue
            value, original = claim.moment, source.moment
            if value.invalid_zone or original.invalid_zone:
                continue
            if value.hour is not None and original.hour is None:
                continue
            if (original.year is not None and original.day is not None and original.zone is not None
                    and original.hour is not None):
                try:
                    fact = Fact(datetime(original.year, original.month, original.day, original.hour,
                        original.minute, original.second or 0, tzinfo=original.zone), 'datetime')
                    if _same(value, fact):
                        supported = True
                        break
                except ValueError:
                    continue
            if value.month is not None and ((value.month, value.day) != (original.month, original.day)
                                          or value.year not in (None, original.year)):
                continue
            if value.hour is not None and (value.hour, value.minute, value.zone) != (original.hour, original.minute, original.zone):
                continue
            if value.second is not None and value.second != original.second:
                continue
            if value.zone is not None and value.zone != original.zone:
                continue
            supported = True
            break
        if not supported:
            return ['证据比对中的截止日期和时刻必须与本条已读取原文及截止类型一致；不要把问题里的数字当作证据。']
    return []
