"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-05-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enum types
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'player');")
    op.execute("CREATE TYPE fixture_status AS ENUM ('scheduled', 'live', 'completed', 'postponed');")
    op.execute("CREATE TYPE fixture_stage AS ENUM ('group', 'round_16', 'quarter_final', 'semi_final', 'third_place', 'final');")
    op.execute("CREATE TYPE ko_round AS ENUM ('round_16', 'quarter_final', 'semi_final', 'final', 'champion');")

    # 2. users table and index
    op.execute("""
    CREATE TABLE users (
        id               SERIAL PRIMARY KEY,
        email            VARCHAR(320) NOT NULL UNIQUE,
        hashed_password  VARCHAR(255) NOT NULL,
        display_name     VARCHAR(100) NOT NULL,
        role             user_role    NOT NULL DEFAULT 'player',
        total_points     INTEGER      NOT NULL DEFAULT 0,
        current_rank     INTEGER,
        is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    """)
    op.execute("CREATE INDEX ix_users_email ON users(email);")

    # 3. leagues table
    op.execute("""
    CREATE TABLE leagues (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(120) NOT NULL,
        invite_token VARCHAR(16)  NOT NULL UNIQUE,
        created_by   INTEGER      NOT NULL REFERENCES users(id),
        is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
    );
    """)

    # 4. league_members table and indexes
    op.execute("""
    CREATE TABLE league_members (
        id        SERIAL PRIMARY KEY,
        user_id   INTEGER     NOT NULL REFERENCES users(id),
        league_id INTEGER     NOT NULL REFERENCES leagues(id),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_league_member UNIQUE (user_id, league_id)
    );
    """)
    op.execute("CREATE INDEX ix_league_members_user_id ON league_members(user_id);")
    op.execute("CREATE INDEX ix_league_members_league_id ON league_members(league_id);")

    # 5. fixtures table and indexes
    op.execute("""
    CREATE TABLE fixtures (
        id           SERIAL PRIMARY KEY,
        external_id  VARCHAR(64) UNIQUE,
        stage        fixture_stage  NOT NULL,
        group_code   CHAR(1),
        matchday     SMALLINT,
        home_team    VARCHAR(80)    NOT NULL,
        away_team    VARCHAR(80)    NOT NULL,
        kickoff_time TIMESTAMPTZ    NOT NULL,
        home_score   SMALLINT,
        away_score   SMALLINT,
        status       fixture_status NOT NULL DEFAULT 'scheduled',
        bracket_slot VARCHAR(20),
        updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
    );
    """)
    op.execute("CREATE INDEX ix_fixtures_kickoff ON fixtures(kickoff_time);")
    op.execute("CREATE INDEX ix_fixtures_status ON fixtures(status);")

    # 6. match_predictions table and indexes
    op.execute("""
    CREATE TABLE match_predictions (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER     NOT NULL REFERENCES users(id),
        fixture_id     INTEGER     NOT NULL REFERENCES fixtures(id),
        predicted_home SMALLINT    NOT NULL CHECK (predicted_home >= 0),
        predicted_away SMALLINT    NOT NULL CHECK (predicted_away >= 0),
        points_awarded SMALLINT    NOT NULL DEFAULT 0,
        is_locked      BOOLEAN     NOT NULL DEFAULT FALSE,
        submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_match_pred_user_fixture UNIQUE (user_id, fixture_id)
    );
    """)
    op.execute("CREATE INDEX ix_match_pred_user_id ON match_predictions(user_id);")
    op.execute("CREATE INDEX ix_match_pred_fixture_id ON match_predictions(fixture_id);")

    # 7. Match prediction lock trigger
    op.execute("""
    CREATE OR REPLACE FUNCTION enforce_match_pred_lock() RETURNS TRIGGER AS $$
    DECLARE ko TIMESTAMPTZ;
    BEGIN
        SELECT kickoff_time INTO ko FROM fixtures WHERE id = NEW.fixture_id;
        IF now() >= ko - INTERVAL '15 minutes' THEN
            RAISE EXCEPTION 'match_prediction_locked'
                USING DETAIL = 'Submission window has closed for this fixture.';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)
    op.execute("""
    CREATE TRIGGER trg_match_pred_lock
    BEFORE INSERT OR UPDATE ON match_predictions
    FOR EACH ROW EXECUTE FUNCTION enforce_match_pred_lock();
    """)

    # 8. bracket_predictions table
    op.execute("""
    CREATE TABLE bracket_predictions (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER     NOT NULL REFERENCES users(id),
        is_locked    BOOLEAN     NOT NULL DEFAULT FALSE,
        total_points INTEGER     NOT NULL DEFAULT 0,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_bracket_per_user UNIQUE (user_id)
    );
    """)

    # 9. bracket_group_picks table and index
    op.execute("""
    CREATE TABLE bracket_group_picks (
        id             SERIAL PRIMARY KEY,
        bracket_id     INTEGER     NOT NULL REFERENCES bracket_predictions(id) ON DELETE CASCADE,
        group_code     CHAR(1)     NOT NULL,
        position       SMALLINT    NOT NULL,
        predicted_team VARCHAR(80) NOT NULL,
        CONSTRAINT uq_bracket_group_pos UNIQUE (bracket_id, group_code, position)
    );
    """)
    op.execute("CREATE INDEX ix_bgp_bracket_id ON bracket_group_picks(bracket_id);")

    # 10. bracket_ko_picks table and index
    op.execute("""
    CREATE TABLE bracket_ko_picks (
        id             SERIAL PRIMARY KEY,
        bracket_id     INTEGER     NOT NULL REFERENCES bracket_predictions(id) ON DELETE CASCADE,
        round          ko_round    NOT NULL,
        slot           VARCHAR(10) NOT NULL,
        predicted_team VARCHAR(80) NOT NULL,
        CONSTRAINT uq_bracket_ko_slot UNIQUE (bracket_id, round, slot)
    );
    """)
    op.execute("CREATE INDEX ix_bkp_bracket_id ON bracket_ko_picks(bracket_id);")

    # 11. Bracket lock triggers
    op.execute("""
    CREATE OR REPLACE FUNCTION enforce_bracket_lock() RETURNS TRIGGER AS $$
    DECLARE locked BOOLEAN;
    BEGIN
        SELECT is_locked INTO locked FROM bracket_predictions WHERE id = NEW.bracket_id;
        IF locked THEN
            RAISE EXCEPTION 'bracket_locked'
                USING DETAIL = 'The tournament bracket is now immutable.';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)
    op.execute("""
    CREATE TRIGGER trg_bracket_group_lock
    BEFORE INSERT OR UPDATE ON bracket_group_picks
    FOR EACH ROW EXECUTE FUNCTION enforce_bracket_lock();
    """)
    op.execute("""
    CREATE TRIGGER trg_bracket_ko_lock
    BEFORE INSERT OR UPDATE ON bracket_ko_picks
    FOR EACH ROW EXECUTE FUNCTION enforce_bracket_lock();
    """)

    # 12. historical_rankings table and index
    op.execute("""
    CREATE TABLE historical_rankings (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER     NOT NULL REFERENCES users(id),
        league_id      INTEGER     NOT NULL REFERENCES leagues(id),
        matchday_id    VARCHAR(30),
        points_at_time INTEGER     NOT NULL,
        rank_at_time   SMALLINT    NOT NULL,
        recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)
    op.execute("""
    CREATE INDEX ix_histrank_user_league_recorded
        ON historical_rankings(user_id, league_id, recorded_at);
    """)

def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS historical_rankings CASCADE;")
    op.execute("DROP TABLE IF EXISTS bracket_ko_picks CASCADE;")
    op.execute("DROP TABLE IF EXISTS bracket_group_picks CASCADE;")
    op.execute("DROP TABLE IF EXISTS bracket_predictions CASCADE;")
    op.execute("DROP TABLE IF EXISTS match_predictions CASCADE;")
    op.execute("DROP TABLE IF EXISTS fixtures CASCADE;")
    op.execute("DROP TABLE IF EXISTS league_members CASCADE;")
    op.execute("DROP TABLE IF EXISTS leagues CASCADE;")
    op.execute("DROP TABLE IF EXISTS users CASCADE;")
    
    op.execute("DROP TYPE IF EXISTS ko_round CASCADE;")
    op.execute("DROP TYPE IF EXISTS fixture_stage CASCADE;")
    op.execute("DROP TYPE IF EXISTS fixture_status CASCADE;")
    op.execute("DROP TYPE IF EXISTS user_role CASCADE;")
    
    op.execute("DROP FUNCTION IF EXISTS enforce_match_pred_lock() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS enforce_bracket_lock() CASCADE;")
