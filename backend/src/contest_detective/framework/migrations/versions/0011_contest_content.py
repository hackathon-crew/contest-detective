"""Add lossless content and offline refresh audit storage without importing data."""
from alembic import op
import sqlalchemy as sa

revision = '0011_contest_content'
down_revision = '0010_account_center'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('contest_details', sa.Column('introduction', sa.JSON(), nullable=True))
    for name, default in [('documents', '[]'), ('coverage', '{}'), ('themes', '[]'), ('theme_sources', '[]')]:
        op.add_column('contest_details', sa.Column(name, sa.JSON(), nullable=False, server_default=default))
    op.add_column('contest_pages', sa.Column('extractor_version', sa.String(100), nullable=True))
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('contest_claims', recreate='always',
                                 naming_convention={'pk': 'pk_%(table_name)s'}) as batch:
            batch.drop_constraint('pk_contest_claims', type_='primary')
            batch.create_primary_key('pk_contest_claims', ['contest_id', 'page_id', 'field', 'value'])
    else:
        for column in ('contest_id', 'page_id', 'field', 'value'):
            op.alter_column('contest_claims', column, nullable=False)
        primary_key = sa.inspect(op.get_bind()).get_pk_constraint('contest_claims')
        if primary_key.get('name'):
            op.drop_constraint(primary_key['name'], 'contest_claims', type_='primary')
        op.create_primary_key('pk_contest_claims', 'contest_claims',
                              ['contest_id', 'page_id', 'field', 'value'])
    op.create_table('content_refresh_runs',
        sa.Column('manifest_id', sa.String(100), primary_key=True),
        sa.Column('manifest_hash', sa.String(64), nullable=False))
    op.create_table('content_refresh_entries',
        sa.Column('manifest_id', sa.String(100), sa.ForeignKey('content_refresh_runs.manifest_id'), primary_key=True),
        sa.Column('entry_key', sa.String(200), primary_key=True),
        sa.Column('entry_hash', sa.String(64), nullable=False),
        sa.Column('contest_id', sa.String(36), sa.ForeignKey('contests.id'), nullable=False),
        sa.Column('after_fingerprint', sa.String(64), nullable=False))


def downgrade():
    connection = op.get_bind()
    sqlite = connection.dialect.name == 'sqlite'
    if connection.execute(sa.text('SELECT 1 FROM contest_claims GROUP BY contest_id, page_id, field HAVING count(*) > 1 LIMIT 1')).first():
        raise ValueError('Rollback imported conflict data before downgrading the content schema')
    documents = ("SELECT 1 FROM contest_details WHERE documents != '[]' LIMIT 1" if sqlite
                 else "SELECT 1 FROM contest_details WHERE documents::jsonb <> '[]'::jsonb LIMIT 1")
    if connection.execute(sa.text(documents)).first():
        raise ValueError('Rollback imported content before downgrading; evidence must not be discarded')
    op.drop_table('content_refresh_entries')
    op.drop_table('content_refresh_runs')
    if sqlite:
        with op.batch_alter_table('contest_claims', recreate='always') as batch:
            batch.drop_constraint('pk_contest_claims', type_='primary')
            batch.create_primary_key('pk_contest_claims', ['contest_id', 'page_id', 'field'])
        with op.batch_alter_table('contest_details') as batch:
            for name in ('introduction', 'documents', 'coverage', 'themes', 'theme_sources'):
                batch.drop_column(name)
        with op.batch_alter_table('contest_pages') as batch:
            batch.drop_column('extractor_version')
    else:
        primary_key = sa.inspect(connection).get_pk_constraint('contest_claims')
        if primary_key.get('name'):
            op.drop_constraint(primary_key['name'], 'contest_claims', type_='primary')
        for column in ('contest_id', 'page_id', 'field'):
            op.alter_column('contest_claims', column, nullable=False)
        op.create_primary_key('pk_contest_claims', 'contest_claims', ['contest_id', 'page_id', 'field'])
        for name in ('introduction', 'documents', 'coverage', 'themes', 'theme_sources'):
            op.drop_column('contest_details', name)
        op.drop_column('contest_pages', 'extractor_version')
