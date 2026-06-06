"""Drop company column from users

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("users", "company")


def downgrade() -> None:
    op.add_column("users", sa.Column("company", sa.String(150), nullable=True))
