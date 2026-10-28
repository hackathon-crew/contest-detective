"""Store one BGE-M3 embedding per contest on PostgreSQL only."""
from alembic import op
import sqlalchemy as sa

revision = '0020_contest_embeddings'
down_revision = '0019_account_conversations'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if connection.dialect.name != 'postgresql':
        return
    vector_schema = connection.execute(sa.text('''SELECT n.nspname FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector' ''')).scalar_one()
    qualified = connection.dialect.identifier_preparer.quote_schema(vector_schema)
    op.execute(f'''CREATE TABLE contest_embeddings (
        contest_id VARCHAR(36) PRIMARY KEY REFERENCES contests(id) ON DELETE CASCADE,
        content_hash VARCHAR(64) NOT NULL,
        embedding {qualified}.vector(1024) NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL
    )''')


def downgrade():
    if op.get_bind().dialect.name == 'postgresql':
        op.drop_table('contest_embeddings')
