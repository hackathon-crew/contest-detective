"""核实的是字段及其出处，转载数量不会把一个字段升级为官方。"""
from datetime import datetime, timezone

from .schemas import DATE_FIELDS, ContestField, FieldValue, Source, utc_iso


def resolve(field: ContestField, claims: list[Source]) -> FieldValue:
    sources = [Source.model_validate(claim.model_dump() | {'stale': False}) for claim in claims]
    for source in sources:
        if field in DATE_FIELDS:
            source.value = utc_iso(source.value)
    if not sources:
        return FieldValue(value=None, level='not_found')

    def publication(source):
        return (source.published_at or datetime.min.replace(tzinfo=timezone.utc), source.url, source.value)

    official = [source for source in sources if source.is_official]
    if official:
        value = max(official, key=publication).value
        for source in sources:
            source.stale = not source.is_official and source.value != value
        return FieldValue(value=value, level='official', sources=sources)

    values = {source.value for source in sources}
    if len(values) == 1:
        return FieldValue(value=sources[0].value, level='reposted', sources=sources)
    value = min(values) if field in DATE_FIELDS else max(sources, key=publication).value
    return FieldValue(value=value, level='conflict', sources=sources)
