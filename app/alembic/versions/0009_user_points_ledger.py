"""create user_points_ledger table

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-31
"""
from alembic import op

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    DO $$ BEGIN
        CREATE TYPE points_source_type AS ENUM ('match', 'group_bracket', 'ko_bracket');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    """)
    op.execute("""
    CREATE TABLE user_points_ledger (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id),
        tournament_id  INTEGER NOT NULL REFERENCES tournaments(id),
        points_awarded SMALLINT NOT NULL,
        source_type    points_source_type NOT NULL,
        source_id      VARCHAR(80) NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)
    op.execute("CREATE INDEX ix_user_points_ledger_user_id ON user_points_ledger(user_id);")
    op.execute("CREATE INDEX ix_user_points_ledger_tournament_id ON user_points_ledger(tournament_id);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_points_ledger;")
    op.execute("DROP TYPE IF EXISTS points_source_type;")
