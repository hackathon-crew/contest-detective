"""Store unused beta invitations and account chat entitlement."""

from alembic import op
import sqlalchemy as sa

revision = '0022_registration_invites'
down_revision = '0021_guest_question_usage'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'registration_invites',
        sa.Column('code_hash', sa.String(64), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column(
        'users', sa.Column('unlimited_chat', sa.Boolean(), nullable=False, server_default=sa.false())
    )


def downgrade():
    op.drop_column('users', 'unlimited_chat')
    op.drop_table('registration_invites')
