"""Remove any remaining league_invite rows from tournament_email_settings and email_log

Migration 0014 cleaned email_template and user_email_preferences but missed these
two tables. Any league_invite rows left there cause SQLAlchemy to throw ValueError
when deserialising the email_type enum, breaking the Email Types admin tab.

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-01
"""
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM tournament_email_settings WHERE email_type = 'league_invite'")
    op.execute("DELETE FROM email_log WHERE email_type = 'league_invite'")


def downgrade() -> None:
    pass  # data not restored on downgrade
