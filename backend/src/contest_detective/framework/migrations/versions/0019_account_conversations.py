"""Persist conversations and turns within their owning account."""
from alembic import op
import sqlalchemy as sa
from fastapi_users_db_sqlalchemy import GUID

revision = '0019_account_conversations'
down_revision = '0018_retrieval_windows'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('chat_conversations',
        sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('title', sa.String(128), nullable=False),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('updated_at', sa.BigInteger(), nullable=False))
    op.create_table('chat_turns',
        sa.Column('user_id', GUID(), primary_key=True),
        sa.Column('conversation_id', sa.String(64), primary_key=True),
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('created_at', sa.BigInteger(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['user_id', 'conversation_id'],
            ['chat_conversations.user_id', 'chat_conversations.id'], ondelete='CASCADE'))


def downgrade():
    op.drop_table('chat_turns')
    op.drop_table('chat_conversations')
