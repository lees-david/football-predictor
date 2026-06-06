"""Add football-data.org integration: teams table and fixture columns

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tournament_id", sa.Integer, sa.ForeignKey("tournaments.id"), nullable=False),
        sa.Column("data_source_team_id", sa.Integer, nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("tla", sa.String(5), nullable=True),
        sa.Column("crest_url", sa.String(512), nullable=True),
    )
    op.create_unique_constraint(
        "uq_teams_data_source_team_id", "teams", ["data_source_team_id"]
    )

    op.add_column("fixtures", sa.Column("data_source_match_id", sa.BigInteger, nullable=True))
    op.create_unique_constraint(
        "uq_fixtures_data_source_match_id", "fixtures", ["data_source_match_id"]
    )
    op.add_column("fixtures", sa.Column("match_duration", sa.String(20), nullable=True))
    op.add_column("fixtures", sa.Column("home_pens", sa.SmallInteger, nullable=True))
    op.add_column("fixtures", sa.Column("away_pens", sa.SmallInteger, nullable=True))


def downgrade():
    op.drop_column("fixtures", "away_pens")
    op.drop_column("fixtures", "home_pens")
    op.drop_column("fixtures", "match_duration")
    op.drop_constraint("uq_fixtures_data_source_match_id", "fixtures", type_="unique")
    op.drop_column("fixtures", "data_source_match_id")
    op.drop_table("teams")
