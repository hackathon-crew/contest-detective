"""把管道产出的记录写入比赛库。比赛库不再决定核实等级。"""

from contest_detective.server.contest.schemas import ClaimIn, ContestDraft, PageIn
from contest_detective.server.contest.service import save


def persist(session_factory, ctx) -> int:
    saved = 0
    for record in ctx.records:
        contest_id = record.contest_id
        pages: dict[str, list] = {}
        for field, value in record.fields.items():
            for source in value.sources:
                pages.setdefault(source.url, []).append((field, source))
        for _url, items in pages.items():
            source = items[0][1]
            draft = ContestDraft(
                name=record.name, cover_url=record.cover_url, summary=record.summary,
                page=PageIn(url=source.url, site=source.site, title=source.title or record.name,
                            published_at=source.published_at, is_official=source.is_official),
                claims=[ClaimIn(field=field, value=item.value, excerpt=item.excerpt, precision=item.precision)
                        for field, item in items],
            )
            with session_factory() as session:
                contest_id = save(session, draft, contest_id=contest_id)
            saved += 1
        record.contest_id = contest_id
    return saved
