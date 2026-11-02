"""Count daily guest questions without persisting their content."""
from alembic import op
import sqlalchemy as sa

revision = '0021_guest_question_usage'
down_revision = '0020_contest_embeddings'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('guest_question_usage',
        sa.Column('identity', sa.String(64), primary_key=True),
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('investigation_ids', sa.JSON(), nullable=False))


def downgrade():
    op.drop_table('guest_question_usage')
