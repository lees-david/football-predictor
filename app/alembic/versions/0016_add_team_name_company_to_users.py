"""Add team_name and company to users

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("team_name", sa.String(100), nullable=False, server_default=""))
    op.add_column("users", sa.Column("company", sa.String(150), nullable=True))


def downgrade():
    op.drop_column("users", "company")
    op.drop_column("users", "team_name")
