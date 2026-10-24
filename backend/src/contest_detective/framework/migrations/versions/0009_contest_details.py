"""Move contest projections into a one-to-one details table."""

from alembic import op
import sqlalchemy as sa

revision = '0009_contest_details'
down_revision = '0008_pipeline_runs'
branch_labels = None
depends_on = None

DETAIL_COLUMNS = ('cover_url', 'summary', 'start_at', 'end_at', 'next_deadline', 'mode', 'city', 'fields')


def upgrade():
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if 'contest_details' in inspector.get_table_names():
        return
    op.create_table(
        'contest_details',
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('cover_url', sa.Text),
        sa.Column('summary', sa.Text),
        sa.Column('start_at', sa.String(20)),
        sa.Column('end_at', sa.String(20)),
        sa.Column('next_deadline', sa.String(20)),
        sa.Column('mode', sa.String(10)),
        sa.Column('city', sa.Text),
        sa.Column('fields', sa.JSON, nullable=False),
    )
    connection = op.get_bind()
    metadata = sa.MetaData()
    metadata.reflect(connection, only=['contests', 'contest_details'])
    contests = metadata.tables['contests']
    details = metadata.tables['contest_details']
    rows = connection.execute(sa.select(contests)).mappings()
    for row in rows:
        connection.execute(details.insert().values(
            contest_id=row['id'],
            **{column: row[column] for column in DETAIL_COLUMNS},
        ))
    # Keep the old columns as compatibility projections for readers that still
    # inspect the pre-split schema. New reads and writes use contest_details.


def downgrade():
    connection = op.get_bind()
    if 'contest_details' not in sa.inspect(connection).get_table_names():
        return
    metadata = sa.MetaData()
    metadata.reflect(connection, only=['contests', 'contest_details'])
    contests = metadata.tables['contests']
    details = metadata.tables['contest_details']
    rows = connection.execute(sa.select(details)).mappings()
    for row in rows:
        connection.execute(contests.update().where(contests.c.id == row['contest_id']).values(
            **{column: row[column] for column in DETAIL_COLUMNS},
        ))

    op.drop_table('contest_details')
