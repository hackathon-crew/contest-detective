"""来源日期规范化；不完整日期留空，避免借用机器当前日期。"""

import re

import dateparser


def parse_datetime(value: str | None, *, default_timezone: str = 'UTC') -> str | None:
    if not value or not isinstance(value, str):
        return None
    parsed = dateparser.parse(
        value,
        languages=['zh', 'en'],
        settings={
            'TIMEZONE': default_timezone,
            'TO_TIMEZONE': 'UTC',
            'RETURN_AS_TIMEZONE_AWARE': True,
            'STRICT_PARSING': True,
            'REQUIRE_PARTS': ['year', 'month', 'day'],
        },
    )
    return parsed.isoformat(timespec='seconds').replace('+00:00', 'Z') if parsed else None


def parse_date_range(value: str, *, default_timezone: str = 'UTC') -> tuple[str | None, str | None]:
    parts = re.split(r'\s+[-–—]\s+', value, maxsplit=1)
    if len(parts) != 2:
        return parse_datetime(value, default_timezone=default_timezone), None
    start, end = parts
    year = re.search(r'\b(\d{4})\b', end)
    if year and not re.search(r'\b\d{4}\b', start):
        start = f'{start}, {year.group(1)}'
    parsed_start = parse_datetime(start, default_timezone=default_timezone)
    if parsed_start and re.fullmatch(r'\d{1,2},?\s+\d{4}', end.strip()):
        # 同月区间省略右侧月份，例如 Oct 05 - 27, 2026。
        end = f'{parsed_start[:7]}-{end.strip().split(",")[0].split()[0]}'
    return parsed_start, parse_datetime(end, default_timezone=default_timezone)
