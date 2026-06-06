"""Add predictions_reset_at to tournaments

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tournaments",
        sa.Column("predictions_reset_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tournaments", "predictions_reset_at")
