"""日历日期与确切时刻分开保存，已知结构化日期按原文字段修复。"""
from datetime import datetime, timedelta, timezone
import re
from urllib.parse import urlsplit

from alembic import op
import sqlalchemy as sa

revision = '0007_date_precision'
down_revision = '0006_investigations'
branch_labels = None
depends_on = None
BEIJING = timezone(timedelta(hours=8))
DEADLINES = ('registration_deadline', 'submission_deadline', 'deadline_unspecified')


def _day(row):
    parsed = datetime.fromisoformat(row['value'])
    return parsed.date() if row['precision'] == 'day' else parsed.astimezone(BEIJING).date()


def _compatible(left, right):
    return _day(left) == _day(right) if 'day' in (left['precision'], right['precision']) else left['value'] == right['value']


def _resolve(rows):
    def published(row):
        return (row['published_at'] or '', row['url'], row['value'])
    official = [row for row in rows if row['is_official']]
    candidates = official or rows
    agree = all(_compatible(left, right) for left in candidates for right in candidates)
    chosen = max(candidates, key=published) if official or agree else min(rows, key=lambda row: row['value'])
    if chosen['precision'] == 'day' and (official or agree):
        exact = [row for row in candidates if row['precision'] == 'datetime' and _compatible(chosen, row)]
        if exact:
            chosen = max(exact, key=published)
    return {'value': chosen['value'], 'precision': chosen['precision'],
            'level': 'official' if official else 'reposted' if agree else 'conflict'}


def upgrade():
    op.add_column('contest_claims', sa.Column('precision', sa.String(8), nullable=False, server_default='datetime'))
    connection = op.get_bind()
    metadata = sa.MetaData()
    metadata.reflect(connection, only=['contests', 'contest_pages', 'contest_claims'])
    contests, pages, claims = [metadata.tables[name] for name in ['contests', 'contest_pages', 'contest_claims']]
    rows = connection.execute(sa.select(claims, pages.c.url, pages.c.site, pages.c.published_at,
                                       pages.c.is_official).join(pages, claims.c.page_id == pages.c.id)).mappings().all()
    changed = set()
    for row in rows:
        host = (urlsplit(row['url']).hostname or '').lower().rstrip('.')
        day = None
        if row['site'] == 'Devpost' and (host == 'devpost.com' or host.endswith('.devpost.com')):
            if row['field'] == 'submission_deadline' and row['excerpt'].startswith('submission_period_dates: '):
                day = datetime.fromisoformat(row['value']).date().isoformat()
        if row['site'] == 'WaytoAGI' and host == 'events.waytoagi.com':
            key = {'start_at': 'date', 'end_at': 'endDate', 'deadline_unspecified': 'deadline'}.get(row['field'])
            match = re.fullmatch(rf'{key}: (\d{{4}}-\d{{2}}-\d{{2}})', row['excerpt']) if key else None
            if match:
                day = match[1]
        if day:
            connection.execute(claims.update().where(claims.c.contest_id == row['contest_id'],
                claims.c.page_id == row['page_id'], claims.c.field == row['field']).values(
                    precision='day', value=day + 'T00:00:00Z'))
            changed.add((row['contest_id'], row['field']))

    updated = connection.execute(sa.select(claims, pages.c.url, pages.c.published_at,
                                          pages.c.is_official).join(pages, claims.c.page_id == pages.c.id)).mappings().all()
    now = datetime.now(timezone.utc)
    for contest in connection.execute(sa.select(contests)).mappings().all():
        fields = {key: dict(value, precision=value.get('precision', 'datetime'))
                  for key, value in contest['fields'].items()}
        for contest_id, field in changed:
            if contest_id == contest['id']:
                fields[field] = _resolve([row for row in updated if row['contest_id'] == contest_id and row['field'] == field])
        start = fields.get('start_at', {}).get('value')
        start_day = _day(fields['start_at']).isoformat() if start else None
        deadlines = []
        for field in DEADLINES:
            value = fields.get(field, {})
            if not value.get('value'):
                continue
            available = (_day(value) >= now.astimezone(BEIJING).date() if value['precision'] == 'day'
                         else datetime.fromisoformat(value['value']) >= now)
            if available:
                deadlines.append(value['value'])
        connection.execute(contests.update().where(contests.c.id == contest['id']).values(
            fields=fields, start_at=start, start_date=start_day,
            end_at=fields.get('end_at', {}).get('value'), next_deadline=min(deadlines) if deadlines else None))


def downgrade():
    op.drop_column('contest_claims', 'precision')
