"""
0004_invitations_table.py

Revision ID: 0004
Down revision: 0003
Create Date: 2026-05-29

Creates the `invitations` table that tracks UUID invitation tokens
separate from static League.invite_token, enabling proper claimed/expired
tracking without polluting the League row.

The League.invite_token column is kept for backward compatibility but
new invitations flow through this table.
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'invitations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(64), nullable=False),
        sa.Column('league_id', sa.Integer(), sa.ForeignKey('leagues.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('claimed_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_revoked', sa.Boolean(), nullable=False, server_default='false'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token', name='uq_invitations_token'),
    )
    op.create_index('ix_invitations_token', 'invitations', ['token'])
    op.create_index('ix_invitations_league_id', 'invitations', ['league_id'])


def downgrade() -> None:
    op.drop_index('ix_invitations_league_id', table_name='invitations')
    op.drop_index('ix_invitations_token', table_name='invitations')
    op.drop_table('invitations')
