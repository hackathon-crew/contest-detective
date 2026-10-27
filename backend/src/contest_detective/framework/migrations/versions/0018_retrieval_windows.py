"""Project date windows and source hosts for database-side retrieval."""
from datetime import datetime, time, timedelta, timezone
from urllib.parse import urlsplit

from alembic import op
import sqlalchemy as sa

revision = '0018_retrieval_windows'
down_revision = '0017_widen_question'
branch_labels = None
depends_on = None

DATE_FIELDS = ('start_at', 'end_at', 'registration_deadline', 'submission_deadline', 'deadline_unspecified')
INDEXED = ('start_at_lower', 'end_at_upper', 'registration_deadline_upper', 'submission_deadline_upper', 'deadline_unspecified_upper')


def _instant(value):
    delta = value - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def _bounds(fields):
    values = {}
    for field in DATE_FIELDS:
        fact = fields.get(field, {})
        lower = upper = None
        if fact.get('value'):
            parsed = datetime.fromisoformat(fact['value'])
            if fact.get('precision') == 'day':
                lower = datetime.combine(parsed.date(), time(), timezone(timedelta(hours=8)))
                upper = lower + timedelta(days=1)
            else:
                lower = upper = parsed
        values[f'{field}_lower'] = _instant(lower) if lower is not None else None
        values[f'{field}_upper'] = _instant(upper) if upper is not None else None
    return values


def upgrade():
    for field in DATE_FIELDS:
        for bound in ('lower', 'upper'):
            op.add_column('contest_details', sa.Column(f'{field}_{bound}', sa.BigInteger(), nullable=True))
    for column in INDEXED:
        op.create_index(f'ix_contest_details_{column}', 'contest_details', [column])
    op.add_column('contest_pages', sa.Column('host', sa.Text(), nullable=True))
    op.create_index('ix_contest_pages_host', 'contest_pages', ['host'])

    connection = op.get_bind()
    metadata = sa.MetaData()
    details = sa.Table('contest_details', metadata, autoload_with=connection)
    pages = sa.Table('contest_pages', metadata, autoload_with=connection)
    for row in connection.execute(sa.select(details.c.contest_id, details.c.fields)).mappings().all():
        connection.execute(details.update().where(details.c.contest_id == row['contest_id']).values(**_bounds(row['fields'])))
    for row in connection.execute(sa.select(pages.c.id, pages.c.url)).mappings().all():
        connection.execute(pages.update().where(pages.c.id == row['id']).values(
            host=(urlsplit(row['url']).hostname or '').lower().rstrip('.')))


def downgrade():
    op.drop_index('ix_contest_pages_host', 'contest_pages')
    op.drop_column('contest_pages', 'host')
    for column in INDEXED:
        op.drop_index(f'ix_contest_details_{column}', 'contest_details')
    for field in reversed(DATE_FIELDS):
        for bound in ('upper', 'lower'):
            op.drop_column('contest_details', f'{field}_{bound}')
