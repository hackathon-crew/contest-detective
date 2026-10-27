"""Enable pgvector on PostgreSQL; SQLite keeps the same migration chain as a no-op."""

import re

from alembic import op
import sqlalchemy as sa

revision = '0016_pgvector_extension'
down_revision = '0015_registration_codes'
branch_labels = None
depends_on = None

MINIMUM_VERSION = (0, 8, 0)


def _version_tuple(value: str) -> tuple[int, int, int]:
    parts = [int(part) for part in re.findall(r'\d+', value)][:3]
    return tuple(parts + [0] * (3 - len(parts)))


def upgrade():
    connection = op.get_bind()
    if connection.dialect.name != 'postgresql':
        return
    try:
        connection.execute(sa.text('CREATE EXTENSION IF NOT EXISTS vector'))
    except Exception as exc:
        raise RuntimeError(
            'PostgreSQL role needs permission to CREATE EXTENSION vector: ' + str(exc)
        ) from exc
    version = connection.execute(
        sa.text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ).scalar_one_or_none()
    if version is None:
        raise RuntimeError('pgvector extension is not installed')
    if _version_tuple(version) < MINIMUM_VERSION:
        raise RuntimeError(
            f'pgvector {version} is too old; >= 0.8.0 is required for hnsw.iterative_scan'
        )


def downgrade():
    # The extension is shared by the database; dropping it belongs to an explicit admin action.
    pass
