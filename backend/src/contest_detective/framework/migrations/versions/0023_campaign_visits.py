"""Store first-touch campaign arrivals and verified signups."""

from alembic import op
import sqlalchemy as sa

revision = '0023_campaign_visits'
down_revision = '0022_registration_invites'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'campaign_visits',
        sa.Column('campaign', sa.String(40), primary_key=True),
        sa.Column('visitor_id', sa.String(36), primary_key=True),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('content', sa.String(48), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('registrations', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_table('campaign_visits')
