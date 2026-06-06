"""Seed password_reset email template

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-01
"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

_SUBJECT = "Reset your Football Predictor password"
_BODY = """<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#1a1a2e;padding:30px;border-radius:8px;color:#fff;">
  <h1 style="color:#6366f1;margin-top:0;">Password Reset</h1>
  <p>Hi,</p>
  <p>We received a request to reset your password. Click the link below — it expires in 1 hour.</p>
  <a href="{{ reset_url }}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:10px;">Reset Password</a>
  <p style="margin-top:20px;color:#9ca3af;font-size:13px;">If you didn't request this, you can safely ignore this email. Your password won't change.</p>
</div>
</body></html>"""


def upgrade() -> None:
    op.execute(f"""
    INSERT INTO email_template (email_type, subject, body_html)
    VALUES ('password_reset', $tpl${_SUBJECT}$tpl$, $tpl${_BODY}$tpl$)
    ON CONFLICT (email_type) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DELETE FROM email_template WHERE email_type = 'password_reset'")
