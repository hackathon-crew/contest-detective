"""Create account center storage without enabling account features."""
from alembic import op
import sqlalchemy as sa
from fastapi_users_db_sqlalchemy import GUID

revision = '0010_account_center'
down_revision = '0009_contest_details'
branch_labels = None
depends_on = None


def owner():
    return sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)


def upgrade():
    op.create_table('account_settings', owner(), sa.Column('push', sa.JSON(), nullable=False),
                    sa.Column('search', sa.JSON(), nullable=False), sa.Column('providers', sa.JSON(), nullable=False),
                    sa.Column('calendar_secret', sa.String(128), unique=True),
                    sa.Column('password_changed_at', sa.DateTime(timezone=True)), sa.PrimaryKeyConstraint('user_id'))
    op.create_table('account_follows', owner(),
                    sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id', ondelete='CASCADE'), nullable=False),
                    sa.Column('reminders', sa.Boolean(), nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('last_fingerprint', sa.String(64)), sa.PrimaryKeyConstraint('user_id', 'contest_id'))
    op.create_table('account_tracks', sa.Column('id', sa.String(36), primary_key=True), owner(),
                    sa.Column('text', sa.String(80), nullable=False), sa.Column('conditions', sa.JSON(), nullable=False),
                    sa.Column('enabled', sa.Boolean(), nullable=False), sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
                    sa.Column('last_sent_at', sa.DateTime(timezone=True)), sa.Column('seen_contests', sa.JSON(), nullable=False))
    op.create_index('ix_account_tracks_user_id', 'account_tracks', ['user_id'])
    op.create_table('account_mail', sa.Column('id', sa.String(36), primary_key=True), owner(),
                    sa.Column('message_key', sa.String(200), nullable=False), sa.Column('kind', sa.String(20), nullable=False),
                    *[sa.Column(name, sa.Text(), nullable=False) for name in ('subject', 'html', 'text')],
                    *[sa.Column(name, sa.String(320), nullable=False) for name in ('sender', 'recipient')],
                    sa.Column('status', sa.String(10), nullable=False), sa.Column('error', sa.Text()),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False), sa.Column('sent_at', sa.DateTime(timezone=True)),
                    sa.UniqueConstraint('user_id', 'message_key', name='uq_account_mail_message'))
    op.create_index('ix_account_mail_user_id', 'account_mail', ['user_id'])
    op.create_table('personal_tokens', owner(), sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
                    sa.Column('prefix', sa.String(16), nullable=False), sa.Column('last_four', sa.String(4), nullable=False),
                    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False), sa.Column('last_used_at', sa.DateTime(timezone=True)),
                    sa.PrimaryKeyConstraint('user_id'))
    op.create_table('email_changes', owner(), sa.Column('email', sa.String(320), nullable=False),
                    sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
                    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False), sa.PrimaryKeyConstraint('user_id'))


def downgrade():
    for name in ('email_changes', 'personal_tokens', 'account_mail', 'account_tracks', 'account_follows', 'account_settings'):
        op.drop_table(name)
