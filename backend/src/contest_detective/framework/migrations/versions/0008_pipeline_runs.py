"""记录每日同步窗口是否已经跑过。"""
from alembic import op
import sqlalchemy as sa

revision = '0008_pipeline_runs'
down_revision = '0007_date_precision'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pipeline_runs',
        sa.Column('job_id', sa.String(64), primary_key=True),
        sa.Column('ran_on', sa.String(10), nullable=False),
    )


def downgrade():
    op.drop_table('pipeline_runs')
