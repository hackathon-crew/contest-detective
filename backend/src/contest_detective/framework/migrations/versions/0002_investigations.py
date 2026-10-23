"""建立调查与事件记录。"""
from alembic import op
import sqlalchemy as sa

revision = '0002_investigations'
down_revision = '0002_llm_budget'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('investigations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('question', sa.String(500), nullable=False),
        sa.Column('user_id', sa.String(36), nullable=True),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('answer', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table('trace_events',
        sa.Column('investigation_id', sa.String(36), sa.ForeignKey('investigations.id'), primary_key=True),
        sa.Column('seq', sa.Integer(), primary_key=True),
        sa.Column('type', sa.String(20), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table('trace_events')
    op.drop_table('investigations')
