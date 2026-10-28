"""Postgres-only persistence and exact cosine search over whole contests."""
import json

from sqlalchemy import String, bindparam, cast, column, select, table, text
from sqlalchemy.types import UserDefinedType

from .provider import validate_vector


class Vector(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kwargs):
        return 'vector(1024)'


embeddings = table('contest_embeddings', column('contest_id', String), column('embedding', Vector()),
                   column('content_hash', String))


def vector_text(vector):
    return json.dumps(validate_vector(vector), separators=(',', ':'), allow_nan=False)


def nearest(session, eligible, vector, *, limit=100):
    distance = embeddings.c.embedding.op('<=>')(cast(bindparam('query_embedding'), Vector()))
    statement = select(embeddings.c.contest_id).where(embeddings.c.contest_id.in_(eligible.order_by(None))).order_by(
        distance, embeddings.c.contest_id.collate('C')).limit(limit)
    return list(session.scalars(statement, {'query_embedding': vector_text(vector)}))


def put(session, document, vector):
    session.execute(text('''
        INSERT INTO contest_embeddings (contest_id, content_hash, embedding, updated_at)
        VALUES (:contest_id, :content_hash, CAST(:embedding AS vector(1024)), CURRENT_TIMESTAMP)
        ON CONFLICT (contest_id) DO UPDATE SET content_hash = EXCLUDED.content_hash,
            embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at
    '''), {'contest_id': document.contest_id, 'content_hash': document.content_hash, 'embedding': vector_text(vector)})
