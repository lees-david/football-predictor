"""add knockout_winner to fixtures

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-31
"""
import sqlalchemy as sa
from alembic import op

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'fixtures',
        sa.Column('knockout_winner', sa.String(80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('fixtures', 'knockout_winner')
