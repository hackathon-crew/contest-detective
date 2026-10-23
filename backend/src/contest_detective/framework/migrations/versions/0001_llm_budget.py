"""建立模型调用费用账本。"""
from alembic import op
import sqlalchemy as sa

revision = '0001_llm_budget'
down_revision = '0000_base'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('llm_usage',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('reserved_cny', sa.Numeric(20, 10), nullable=False),
        sa.Column('cost_cny', sa.Numeric(20, 10), nullable=False),
        sa.Column('cache_hit_tokens', sa.Integer(), nullable=True),
        sa.Column('cache_miss_tokens', sa.Integer(), nullable=True),
        sa.Column('output_tokens', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table('llm_usage')
