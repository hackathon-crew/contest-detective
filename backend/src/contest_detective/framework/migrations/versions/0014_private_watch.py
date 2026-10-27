"""Private watch state and nullable historical event snapshots."""
from alembic import op
import sqlalchemy as sa
from fastapi_users_db_sqlalchemy import GUID

revision = '0014_private_watch'
down_revision = '0013_merge_account_mail'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contest_page_links', sa.Column('revision', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('contest_page_links', sa.Column('verified_content_hash', sa.String(64), nullable=True))
    op.add_column('contest_page_links', sa.Column('verified_extractor_version', sa.String(100), nullable=True))
    op.add_column('contest_events', sa.Column('before_snapshot', sa.JSON(), nullable=True))
    op.add_column('contest_events', sa.Column('after_snapshot', sa.JSON(), nullable=True))
    op.create_table('watch_subscriptions',
        sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('activated_event_id', sa.Integer(), nullable=False, server_default='0'))
    op.create_table('watch_cursors',
        sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('event_id', sa.Integer(), nullable=False, server_default='0'))
    op.create_table('watch_notifications',
        sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('event_id', sa.Integer(), sa.ForeignKey('contest_events.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True))
    op.create_table('watch_checks',
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('outcome', sa.String(16), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('error_type', sa.String(100), nullable=True),
        sa.Column('last_success_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table('contest_page_links') as batch:
        batch.drop_column('verified_extractor_version')
        batch.drop_column('verified_content_hash')
        batch.drop_column('revision')
    for table in ('watch_notifications', 'watch_cursors', 'watch_subscriptions', 'watch_checks'):
        op.drop_table(table)
    with op.batch_alter_table('contest_events') as batch:
        batch.drop_column('after_snapshot')
        batch.drop_column('before_snapshot')
