"""Persist mail receipts and bounded retry progress."""
from alembic import op
import sqlalchemy as sa

revision = '0012_mail_delivery'
down_revision = '0011_notification_events'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('account_mail', sa.Column('provider_id', sa.String(100)))
    op.add_column('account_mail', sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('account_mail', sa.Column('retry_at', sa.DateTime(timezone=True)))
    op.create_index('ix_account_mail_provider_id', 'account_mail', ['provider_id'])


def downgrade():
    op.drop_index('ix_account_mail_provider_id', 'account_mail')
    for column in ('retry_at', 'attempts', 'provider_id'):
        op.drop_column('account_mail', column)
