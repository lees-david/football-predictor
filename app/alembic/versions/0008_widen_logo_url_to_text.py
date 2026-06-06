"""widen logo_url to Text for base64 storage

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'leagues',
        'logo_url',
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'leagues',
        'logo_url',
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
