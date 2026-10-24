"""Persist contest events and independent notification consumption state."""
from alembic import op
import sqlalchemy as sa
from fastapi_users_db_sqlalchemy import GUID

revision = '0011_notification_events'
down_revision = '0010_account_center'
branch_labels = None
depends_on = None


def owner():
    return sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)


def contest():
    return sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), nullable=False)


def upgrade():
    op.create_table('contest_events', sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
                    contest(), sa.Column('kind', sa.String(10), nullable=False),
                    sa.Column('version', sa.String(64), nullable=False),
                    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_contest_events_contest_id', 'contest_events', ['contest_id'])
    op.create_table('notification_pending', owner(), contest(),
                    sa.Column('event_id', sa.Integer(), nullable=False),
                    sa.Column('version', sa.String(64), nullable=False),
                    sa.Column('reason', sa.String(20), nullable=False),
                    sa.Column('track_ids', sa.JSON(), nullable=False),
                    sa.Column('queued_at', sa.DateTime(timezone=True), nullable=False),
                    sa.PrimaryKeyConstraint('user_id', 'contest_id'))
    op.create_table('notification_seen', owner(), contest(),
                    sa.Column('version', sa.String(64), nullable=False),
                    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
                    sa.PrimaryKeyConstraint('user_id', 'contest_id'))
    op.create_table('notification_cursors', sa.Column('name', sa.String(100), primary_key=True),
                    sa.Column('event_id', sa.Integer(), nullable=False))


def downgrade():
    for table in ('notification_cursors', 'notification_seen', 'notification_pending', 'contest_events'):
        op.drop_table(table)
