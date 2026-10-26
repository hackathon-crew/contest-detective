"""Add registration email codes and their send ledger."""
from alembic import op
import sqlalchemy as sa

revision = '0015_registration_codes'
down_revision = '0014_private_watch'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'registration_codes',
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('sends', sa.Integer(), nullable=False),
        sa.Column('window_started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('email'),
    )
    op.create_table(
        'registration_code_sends',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_registration_code_sends_email', 'registration_code_sends', ['email'])
    op.create_index('ix_registration_code_sends_created_at', 'registration_code_sends', ['created_at'])


def downgrade():
    op.drop_index('ix_registration_code_sends_created_at', 'registration_code_sends')
    op.drop_index('ix_registration_code_sends_email', 'registration_code_sends')
    op.drop_table('registration_code_sends')
    op.drop_table('registration_codes')
