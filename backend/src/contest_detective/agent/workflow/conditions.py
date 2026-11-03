"""额外硬条件只比较有出处的事实；不能量化时保留为待核实，不能放宽条件。"""
import re


def _bounds(text, currency=None):
    found = re.findall(r'\d[\d,]*(?:\.\d+)?\s*[万千]?', text)
    if re.search(r'(?:不|非|不是|不算|not|isn.t)\s*(?:免费|free)|大约|约莫|大概|about|approximately', text, re.I):
        return None
    if re.search(r'免费|免(?:报名|注册)费|\bfree\b', text, re.I) and not found:
        # 带人群或时段条件的免费不能当成对所有人都免费。
        return None if re.search(r'学生|会员|早鸟|限时|职场|student|member', text, re.I) else (0.0, 0.0)
    if len(found) != 1:
        return None
    actual_currency = 'USD' if re.search(r'USD|US\$|美元|\$', text, re.I) else 'CNY' if re.search(r'CNY|RMB|人民币|[¥￥元]', text, re.I) else None
    raw = found[0].replace(',', '').replace(' ', '')
    scale = 10000 if raw.endswith('万') else 1000 if raw.endswith('千') else 1
    number = float(raw.removesuffix('万').removesuffix('千')) * scale
    if currency and actual_currency != currency and number != 0:
        return None
    if re.search(r'不超过|至多|以内|以下|不高于|up to|at most', text, re.I):
        return None, number
    if re.search(r'起|以上|至少|不低于|from|at least|starting', text, re.I):
        return number, None
    return number, number


def satisfies(condition, field):
    if not field.value or not field.sources or field.level == 'conflict':
        return None
    text = field.value
    if condition.operator == 'known':
        return True
    if condition.operator == 'contains':
        return str(condition.value).casefold() in text.casefold()
    if condition.operator == 'equals' and isinstance(condition.value, str):
        return text.strip().casefold() == condition.value.strip().casefold()
    bounds = _bounds(text, condition.currency)
    if bounds is None:
        return None
    lower, upper = bounds
    if condition.operator == 'positive':
        return True if lower is not None and lower > 0 else False if upper is not None and upper <= 0 else None
    expected = float(condition.value)
    if condition.operator == 'minimum':
        return True if lower is not None and lower >= expected else False if upper is not None and upper < expected else None
    if condition.operator == 'maximum':
        return True if upper is not None and upper <= expected else False if lower is not None and lower > expected else None
    if lower == upper == expected:
        return True
    if (lower is not None and expected < lower) or (upper is not None and expected > upper):
        return False
    return None
