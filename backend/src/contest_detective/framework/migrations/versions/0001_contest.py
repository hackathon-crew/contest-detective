"""赛事、来源页面与字段断言。"""
from alembic import op
import sqlalchemy as sa

revision = '0001_contest'
down_revision = '0000_base'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('contests',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(500), nullable=False),
        sa.Column('normalized_name', sa.String(500), nullable=False),
        sa.Column('cover_url', sa.Text), sa.Column('summary', sa.Text),
        sa.Column('start_date', sa.String(10)), sa.Column('start_at', sa.String(20)),
        sa.Column('end_at', sa.String(20)), sa.Column('next_deadline', sa.String(20)),
        sa.Column('mode', sa.String(10)), sa.Column('city', sa.Text),
        sa.Column('fields', sa.JSON, nullable=False),
        sa.UniqueConstraint('normalized_name', 'start_date', name='uq_contest_name_start'))
    op.create_index('ix_contests_start_date', 'contests', ['start_date'])
    op.create_index('ix_contests_mode', 'contests', ['mode'])
    op.create_table('contest_pages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('url', sa.Text, nullable=False, unique=True),
        sa.Column('site', sa.Text, nullable=False), sa.Column('title', sa.Text, nullable=False),
        sa.Column('published_at', sa.String(20)), sa.Column('is_official', sa.Boolean, nullable=False))
    op.create_table('contest_claims',
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('page_id', sa.String(36), sa.ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('field', sa.String(32), primary_key=True),
        sa.Column('value', sa.Text, nullable=False), sa.Column('excerpt', sa.Text, nullable=False))
    op.create_table('contest_page_links',
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('page_id', sa.String(36), sa.ForeignKey('contest_pages.id', ondelete='CASCADE'), primary_key=True))


def downgrade():
    op.drop_table('contest_page_links')
    op.drop_table('contest_claims')
    op.drop_table('contest_pages')
    op.drop_index('ix_contests_mode', table_name='contests')
    op.drop_index('ix_contests_start_date', table_name='contests')
    op.drop_table('contests')
