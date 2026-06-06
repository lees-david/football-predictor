"""Add resend_message_id to email_log

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-04
"""
from alembic import op
import sqlalchemy as sa


revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("email_log", sa.Column("resend_message_id", sa.String(length=255), nullable=True))
    op.create_index("ix_email_log_resend_message_id", "email_log", ["resend_message_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_email_log_resend_message_id", table_name="email_log")
    op.drop_column("email_log", "resend_message_id")
