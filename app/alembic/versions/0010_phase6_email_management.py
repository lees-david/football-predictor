"""Phase 6: email management tables and columns

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-31
"""
from alembic import op

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# Default Jinja2 templates seeded on first migration
# ---------------------------------------------------------------------------

_WELCOME_SUBJECT = "Welcome to {{ tournament_name }}!"
_WELCOME_BODY = """<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#1a1a2e;padding:30px;border-radius:8px;color:#fff;">
  <h1 style="color:#6366f1;margin-top:0;">Welcome, {{ user_name }}! 🎉</h1>
  <p>You've been added to <strong>{{ tournament_name }}</strong>. Get ready to predict match results and compete against your friends!</p>
  <p>Head over to the app to make your first predictions before the tournament begins.</p>
  <a href="{{ site_url }}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:10px;">Go to the app</a>
</div>
</body></html>"""

_INVITE_SUBJECT = "{{ inviter_name }} invited you to join {{ league_name }}"
_INVITE_BODY = """<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#1a1a2e;padding:30px;border-radius:8px;color:#fff;">
  <h1 style="color:#6366f1;margin-top:0;">You've been invited! 🏆</h1>
  <p><strong>{{ inviter_name }}</strong> has invited you to join <strong>{{ league_name }}</strong> for <strong>{{ tournament_name }}</strong>.</p>
  <a href="{{ invite_url }}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:10px;">Accept invitation</a>
</div>
</body></html>"""

_ROUND_SUBJECT = "{{ round_name }} results — your scores are in"
_ROUND_BODY = """<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#1a1a2e;padding:30px;border-radius:8px;color:#fff;">
  <h1 style="color:#6366f1;margin-top:0;">{{ round_name }} Results</h1>
  <p>Hi {{ user_name }}, here's how you did.</p>

  {% if matches %}
  <h2 style="color:#a5b4fc;font-size:16px;">Match Results</h2>
  <table style="width:100%;border-collapse:collapse;">
    {% for m in matches %}
    <tr style="border-bottom:1px solid #333;">
      <td style="padding:8px 4px;">{{ m.home_team }} {{ m.home_score }}–{{ m.away_score }} {{ m.away_team }}</td>
      <td style="padding:8px 4px;color:#9ca3af;">Your prediction: {{ m.predicted_home }}–{{ m.predicted_away }}</td>
      <td style="padding:8px 4px;text-align:right;color:{% if m.points > 0 %}#4ade80{% else %}#9ca3af{% endif %};">+{{ m.points }} pts</td>
    </tr>
    {% endfor %}
  </table>
  {% endif %}

  {% if leagues %}
  <h2 style="color:#a5b4fc;font-size:16px;margin-top:20px;">Your Leagues</h2>
  {% for l in leagues %}
  <div style="background:#16213e;padding:10px 14px;border-radius:6px;margin-bottom:8px;">
    <strong>{{ l.name }}</strong>
    <span style="float:right;">Rank #{{ l.rank }}
      {% if l.movement > 0 %}<span style="color:#4ade80;">▲{{ l.movement }}</span>
      {% elif l.movement < 0 %}<span style="color:#f87171;">▼{{ l.movement | abs }}</span>
      {% else %}<span style="color:#9ca3af;">–</span>{% endif %}
    </span>
  </div>
  {% endfor %}
  {% endif %}

  {% if next_round_name %}
  <div style="background:#16213e;padding:14px;border-radius:6px;margin-top:20px;border-left:3px solid #6366f1;">
    <strong style="color:#a5b4fc;">Up next: {{ next_round_name }}</strong><br>
    <span style="color:#9ca3af;font-size:14px;">Predictions lock {{ next_round_lock_time }}</span>
  </div>
  {% endif %}

  <a href="{{ site_url }}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:20px;">View full leaderboard</a>
</div>
</body></html>"""

_DIGEST_SUBJECT = "Daily update — {{ tournament_name }} ({{ digest_date }})"
_DIGEST_BODY = """<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#1a1a2e;padding:30px;border-radius:8px;color:#fff;">
  <h1 style="color:#6366f1;margin-top:0;">Daily Update — {{ digest_date }}</h1>
  <p>Hi {{ user_name }},</p>

  {% if matches %}
  <h2 style="color:#a5b4fc;font-size:16px;">Today's Results</h2>
  <table style="width:100%;border-collapse:collapse;">
    {% for m in matches %}
    <tr style="border-bottom:1px solid #333;">
      <td style="padding:8px 4px;">{{ m.home_team }} {{ m.home_score }}–{{ m.away_score }} {{ m.away_team }}</td>
      <td style="padding:8px 4px;text-align:right;color:{% if m.points > 0 %}#4ade80{% else %}#9ca3af{% endif %};">+{{ m.points }} pts</td>
    </tr>
    {% endfor %}
  </table>
  {% endif %}

  {% if leagues %}
  <h2 style="color:#a5b4fc;font-size:16px;margin-top:20px;">Standings</h2>
  {% for l in leagues %}
  <div style="background:#16213e;padding:10px 14px;border-radius:6px;margin-bottom:8px;">
    <strong>{{ l.name }}</strong>
    <span style="float:right;">Rank #{{ l.rank }}
      {% if l.movement > 0 %}<span style="color:#4ade80;">▲{{ l.movement }}</span>
      {% elif l.movement < 0 %}<span style="color:#f87171;">▼{{ l.movement | abs }}</span>
      {% else %}<span style="color:#9ca3af;">–</span>{% endif %}
    </span>
  </div>
  {% endfor %}
  {% endif %}

  {% if upcoming_fixtures %}
  <h2 style="color:#a5b4fc;font-size:16px;margin-top:20px;">Coming Up</h2>
  {% for f in upcoming_fixtures %}
  <div style="padding:6px 0;border-bottom:1px solid #2a2a4a;">{{ f.home_team }} vs {{ f.away_team }} — {{ f.kickoff_time }}</div>
  {% endfor %}
  {% endif %}

  <a href="{{ site_url }}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:20px;">Open app</a>
</div>
</body></html>"""


def _esc(s: str) -> str:
    """Escape single quotes for SQL dollar-quoted strings."""
    return s.replace("'", "''")


def upgrade() -> None:
    # --- enums ---
    op.execute("""
    DO $$ BEGIN
        CREATE TYPE email_type AS ENUM ('welcome', 'league_invite', 'round_summary', 'daily_digest');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    """)
    op.execute("""
    DO $$ BEGIN
        CREATE TYPE email_mode AS ENUM ('simulation', 'live');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    """)

    # --- columns on existing tables ---
    op.execute("""
    ALTER TABLE tournaments
        ADD COLUMN IF NOT EXISTS email_mode email_mode NOT NULL DEFAULT 'simulation';
    """)
    op.execute("""
    ALTER TABLE leagues
        ADD COLUMN IF NOT EXISTS emails_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    """)

    # --- email_template ---
    op.execute("""
    CREATE TABLE IF NOT EXISTS email_template (
        id         SERIAL PRIMARY KEY,
        email_type email_type NOT NULL UNIQUE,
        subject    VARCHAR(255) NOT NULL,
        body_html  TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)

    # --- tournament_email_settings ---
    op.execute("""
    CREATE TABLE IF NOT EXISTS tournament_email_settings (
        id            SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        email_type    email_type NOT NULL,
        enabled       BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE(tournament_id, email_type)
    );
    """)

    # --- email_log ---
    op.execute("""
    CREATE TABLE IF NOT EXISTS email_log (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
        email_type    email_type NOT NULL,
        subject       VARCHAR(255) NOT NULL,
        to_address    VARCHAR(320) NOT NULL,
        body_html     TEXT NOT NULL,
        simulated     BOOLEAN NOT NULL DEFAULT TRUE,
        status        VARCHAR(20) NOT NULL DEFAULT 'queued',
        sent_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_log_user_id ON email_log(user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_email_log_created_at ON email_log(created_at DESC);")

    # --- user_email_preferences ---
    op.execute("""
    CREATE TABLE IF NOT EXISTS user_email_preferences (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_type email_type NOT NULL,
        opted_in   BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE(user_id, email_type)
    );
    """)

    # --- seed default templates ---
    op.execute(f"""
    INSERT INTO email_template (email_type, subject, body_html) VALUES
        ('welcome',      $tpl${_WELCOME_SUBJECT}$tpl$, $tpl${_WELCOME_BODY}$tpl$),
        ('league_invite',$tpl${_INVITE_SUBJECT}$tpl$,  $tpl${_INVITE_BODY}$tpl$),
        ('round_summary',$tpl${_ROUND_SUBJECT}$tpl$,   $tpl${_ROUND_BODY}$tpl$),
        ('daily_digest', $tpl${_DIGEST_SUBJECT}$tpl$,  $tpl${_DIGEST_BODY}$tpl$)
    ON CONFLICT (email_type) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_email_preferences;")
    op.execute("DROP TABLE IF EXISTS email_log;")
    op.execute("DROP TABLE IF EXISTS tournament_email_settings;")
    op.execute("DROP TABLE IF EXISTS email_template;")
    op.execute("ALTER TABLE leagues DROP COLUMN IF EXISTS emails_enabled;")
    op.execute("ALTER TABLE tournaments DROP COLUMN IF EXISTS email_mode;")
    op.execute("DROP TYPE IF EXISTS email_mode;")
    op.execute("DROP TYPE IF EXISTS email_type;")
