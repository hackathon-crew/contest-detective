"""核实的是字段及其出处，转载数量不会把一个字段升级为官方。"""
from datetime import datetime, timezone

from .schemas import DATE_FIELDS, TEXT_FIELDS, ContestField, FieldResolution, FieldValue, Source, calendar_date, date_value


def resolution_matches(field: ContestField, sources: list[Source], resolution: FieldResolution) -> bool:
    expected = {(item.value, item.excerpt, item.precision) for item in sources}
    actual = {(item.value, item.excerpt, item.precision) for item in resolution.claims}
    return (field in TEXT_FIELDS and bool(expected) and expected == actual
            and all(item.field == field for item in resolution.claims))


def resolve(field: ContestField, claims: list[Source], resolution: FieldResolution | None = None) -> FieldValue:
    sources = [Source.model_validate(claim.model_dump() | {'stale': False}) for claim in claims]
    if field in TEXT_FIELDS:
        # 与入库的 (网页、字段、值) 身份一致，重复摘录不改变参与判断的断言。
        sources = list({(source.url, source.value): source for source in sources}.values())
    for source in sources:
        if field in DATE_FIELDS:
            source.value = date_value(source.value, source.precision)
    if not sources:
        return FieldValue(value=None, level='not_found')
    if field in TEXT_FIELDS and len({source.value for source in sources}) > 1:
        if resolution is None or not resolution_matches(field, sources, resolution):
            # 字面差异只表示需要语义判断；模型缺席或结论过期不能冒充事实冲突。
            return FieldValue(value=None, level='not_found', sources=sources)
        level = ('conflict' if resolution.conflicting else
                 'official' if all(source.is_official for source in sources) else 'reposted')
        return FieldValue(value=resolution.value, level=level, sources=sources)

    def publication(source):
        return (source.published_at or datetime.min.replace(tzinfo=timezone.utc), source.url, source.value)

    def compatible(left, right):
        if field in DATE_FIELDS and 'day' in (left.precision, right.precision):
            return calendar_date(left.value, left.precision) == calendar_date(right.value, right.precision)
        return left.value == right.value

    def refine(selected, candidates):
        if field in DATE_FIELDS and selected.precision == 'day':
            exact = [item for item in candidates if item.precision == 'datetime' and compatible(item, selected)]
            if exact:
                return max(exact, key=publication)
        return selected

    official = [source for source in sources if source.is_official]
    if official:
        selected = refine(max(official, key=publication), official)
        for source in sources:
            source.stale = not source.is_official and not compatible(source, selected)
        level = 'official' if all(compatible(left, right) for left in official for right in official) else 'conflict'
        return FieldValue(value=selected.value, precision=selected.precision, level=level, sources=sources)

    if all(compatible(left, right) for left in sources for right in sources):
        selected = refine(max(sources, key=publication), sources)
        return FieldValue(value=selected.value, precision=selected.precision, level='reposted', sources=sources)
    selected = min(sources, key=lambda item: item.value) if field in DATE_FIELDS else max(sources, key=publication)
    return FieldValue(value=selected.value, precision=selected.precision, level='conflict', sources=sources)
