"""Add password_reset to email_type enum

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-01
"""
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ADD VALUE must run outside a transaction (same pattern as 0007).
    op.execute("COMMIT")
    op.execute("ALTER TYPE email_type ADD VALUE IF NOT EXISTS 'password_reset'")
    op.execute("BEGIN")


def downgrade() -> None:
    # Postgres does not support DROP VALUE on an enum — no-op.
    pass
