"""Add broadcast to email_type enum

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-01
"""
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ADD VALUE must run outside a transaction (same pattern as 0020).
    op.execute("COMMIT")
    op.execute("ALTER TYPE email_type ADD VALUE IF NOT EXISTS 'broadcast'")
    op.execute("BEGIN")


def downgrade() -> None:
    # Postgres does not support DROP VALUE on an enum — no-op.
    pass
