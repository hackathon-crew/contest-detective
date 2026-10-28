"""Widen investigation questions so long agent prompts survive PostgreSQL migration."""

from alembic import op
import sqlalchemy as sa

revision = '0017_widen_question'
down_revision = '0016_pgvector_extension'
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('investigations') as batch:
            batch.alter_column('question', existing_type=sa.String(500), type_=sa.Text(),
                               existing_nullable=False)
    else:
        op.alter_column('investigations', 'question', existing_type=sa.String(500),
                        type_=sa.Text(), existing_nullable=False)


def downgrade():
    connection = op.get_bind()
    maximum = connection.execute(sa.text('SELECT max(length(question)) FROM investigations')).scalar()
    if maximum and maximum > 500:
        raise ValueError('Shorten investigations.question before downgrading to varchar(500)')
    if connection.dialect.name == 'sqlite':
        with op.batch_alter_table('investigations') as batch:
            batch.alter_column('question', existing_type=sa.Text(), type_=sa.String(500),
                               existing_nullable=False)
    else:
        op.alter_column('investigations', 'question', existing_type=sa.Text(),
                        type_=sa.String(500), existing_nullable=False)
