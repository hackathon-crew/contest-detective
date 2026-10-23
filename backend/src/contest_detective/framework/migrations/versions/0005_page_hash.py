"""缓存已成功核对的官网正文指纹。"""
from alembic import op
import sqlalchemy as sa

revision = '0005_page_hash'
down_revision = '0003_users'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contest_pages', sa.Column('content_hash', sa.String(64)))


def downgrade():
    op.drop_column('contest_pages', 'content_hash')
