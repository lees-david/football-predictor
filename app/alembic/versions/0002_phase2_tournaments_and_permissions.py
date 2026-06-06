"""phase2 tournaments and permissions

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-29 17:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Update PostgreSQL ENUM types in autocommit block
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE fixture_stage ADD VALUE IF NOT EXISTS 'round_32' BEFORE 'round_16';")
        op.execute("ALTER TYPE ko_round ADD VALUE IF NOT EXISTS 'round_32' BEFORE 'round_16';")

    # 2. Create tournaments table
    op.execute("""
    CREATE TABLE tournaments (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(120) NOT NULL,
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)

    # 3. Seed default active tournament (id=1)
    op.execute("INSERT INTO tournaments (id, name, is_active) VALUES (1, 'World Cup 2026', TRUE);")
    # Reset serial sequence
    op.execute("SELECT setval(pg_get_serial_sequence('tournaments', 'id'), 1);")

    # 4. Add custom permission columns to users table
    op.execute("ALTER TABLE users ADD COLUMN can_manage_leagues BOOLEAN NOT NULL DEFAULT FALSE;")
    op.execute("ALTER TABLE users ADD COLUMN can_invite_users BOOLEAN NOT NULL DEFAULT FALSE;")

    # 5. Add columns to fixtures table (with temporary default 1 to satisfy NOT NULL on existing rows)
    op.execute("ALTER TABLE fixtures ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id) DEFAULT 1;")
    op.execute("ALTER TABLE fixtures ALTER COLUMN tournament_id DROP DEFAULT;")
    op.execute("ALTER TABLE fixtures ALTER COLUMN tournament_id SET NOT NULL;")
    op.execute("ALTER TABLE fixtures ADD COLUMN home_logo VARCHAR(255);")
    op.execute("ALTER TABLE fixtures ADD COLUMN away_logo VARCHAR(255);")

    # 6. Add columns to leagues table
    op.execute("ALTER TABLE leagues ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id) DEFAULT 1;")
    op.execute("ALTER TABLE leagues ALTER COLUMN tournament_id DROP DEFAULT;")
    op.execute("ALTER TABLE leagues ALTER COLUMN tournament_id SET NOT NULL;")

    # 7. Add columns to bracket_predictions table
    op.execute("ALTER TABLE bracket_predictions ADD COLUMN tournament_id INTEGER REFERENCES tournaments(id) DEFAULT 1;")
    op.execute("ALTER TABLE bracket_predictions ALTER COLUMN tournament_id DROP DEFAULT;")
    op.execute("ALTER TABLE bracket_predictions ALTER COLUMN tournament_id SET NOT NULL;")

    # 8. Update unique constraint on bracket_predictions
    op.execute("ALTER TABLE bracket_predictions DROP CONSTRAINT uq_bracket_per_user;")
    op.execute("ALTER TABLE bracket_predictions ADD CONSTRAINT uq_bracket_per_user_tournament UNIQUE (user_id, tournament_id);")

def downgrade() -> None:
    # Revert unique constraint
    op.execute("ALTER TABLE bracket_predictions DROP CONSTRAINT uq_bracket_per_user_tournament;")
    op.execute("ALTER TABLE bracket_predictions ADD CONSTRAINT uq_bracket_per_user UNIQUE (user_id);")

    # Remove columns
    op.execute("ALTER TABLE bracket_predictions DROP COLUMN tournament_id;")
    op.execute("ALTER TABLE leagues DROP COLUMN tournament_id;")
    op.execute("ALTER TABLE fixtures DROP COLUMN away_logo;")
    op.execute("ALTER TABLE fixtures DROP COLUMN home_logo;")
    op.execute("ALTER TABLE fixtures DROP COLUMN tournament_id;")
    op.execute("ALTER TABLE users DROP COLUMN can_invite_users;")
    op.execute("ALTER TABLE users DROP COLUMN can_manage_leagues;")

    # Drop tournaments table
    op.execute("DROP TABLE IF EXISTS tournaments CASCADE;")
