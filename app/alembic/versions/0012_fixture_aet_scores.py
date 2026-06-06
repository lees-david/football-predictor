"""add home/away_score_aet to fixtures

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-31
"""
import sqlalchemy as sa
from alembic import op

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('fixtures', sa.Column('home_score_aet', sa.SmallInteger(), nullable=True))
    op.add_column('fixtures', sa.Column('away_score_aet', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('fixtures', 'away_score_aet')
    op.drop_column('fixtures', 'home_score_aet')
