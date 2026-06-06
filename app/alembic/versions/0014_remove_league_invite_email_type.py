"""Remove league_invite from email system

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-31
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove template and preference rows so the enum value is unused
    op.execute("DELETE FROM email_template WHERE email_type = 'league_invite'")
    op.execute("DELETE FROM user_email_preferences WHERE email_type = 'league_invite'")
    # Postgres does not support DROP VALUE on an enum; the value is left in the
    # DB type but will never be referenced by application code.


def downgrade() -> None:
    pass  # data not restored on downgrade
