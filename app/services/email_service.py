"""
Email service — simulation-aware Resend wrapper.

Send hierarchy for marketing types (round_summary, daily_digest):
  tournament.email_mode == LIVE
  AND tournament_email_settings[type].enabled
  AND league.emails_enabled (at least one of user's leagues)
  AND user_email_preferences[type].opted_in

Transactional types (welcome):
  tournament.email_mode == LIVE  (only check)

Always writes to email_log regardless of mode.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
import jinja2
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.email_template import EmailType
from models.email_log import EmailLog
from models.tournament import EmailMode

logger = logging.getLogger(__name__)

TRANSACTIONAL_TYPES = {EmailType.welcome, EmailType.password_reset}

_jinja_env = jinja2.Environment(
    undefined=jinja2.Undefined,
    autoescape=False,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_site_url(db: AsyncSession) -> str:
    """Resolve the public site URL, checking database settings first, then .env config, with fallback.
    Ensures http:// or https:// scheme prefix is prepended if not present.
    """
    from models.setting import Setting
    res = await db.execute(select(Setting).where(Setting.key == "site_address"))
    row = res.scalar_one_or_none()
    site_url = row.value if row else settings.SITE_URL
    if site_url:
        site_url = site_url.strip()
        if not (site_url.startswith("http://") or site_url.startswith("https://")):
            # If it's a domain/host or localhost, prefix appropriately.
            if "localhost" in site_url or "127.0.0.1" in site_url:
                site_url = f"http://{site_url}"
            else:
                site_url = f"https://{site_url}"
    return site_url or "http://localhost:8083"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def send_email(
    db: AsyncSession,
    *,
    user_id: int,
    to_address: str,
    email_type: EmailType,
    context: dict[str, Any],
    tournament_id: int | None = None,
    bypass_hierarchy: bool = False,
    force_live: bool = False,
) -> EmailLog | None:
    """
    Render and dispatch one email. Returns the EmailLog row, or None if
    suppressed by hierarchy checks (not an error).

    Set bypass_hierarchy=True for admin test-sends and "send now" log actions.
    Set force_live=True for security-critical transactional emails (e.g. password reset)
    that must always send regardless of tournament simulation mode.
    """
    from models.email_template import EmailTemplate
    from models.tournament import Tournament

    # --- load template ---
    tpl_res = await db.execute(
        select(EmailTemplate).where(EmailTemplate.email_type == email_type)
    )
    template = tpl_res.scalar_one_or_none()
    if template is None:
        logger.warning("No template found for email_type=%s", email_type)
        return None

    # Inject or override site_url in context to match database/config values
    if "site_url" not in context or context["site_url"] == "http://localhost:8083":
        context["site_url"] = await get_site_url(db)

    subject = _render(template.subject, context)
    body_html = _render(template.body_html, context)

    # --- determine simulation flag ---
    simulated = True
    if force_live:
        simulated = False
    elif tournament_id:
        t_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
        tournament = t_res.scalar_one_or_none()
        if tournament and tournament.email_mode == EmailMode.live:
            simulated = False

    if not bypass_hierarchy and not simulated:
        # Run full hierarchy check for non-bypassed live sends
        allowed = await _check_hierarchy(db, user_id, email_type, tournament_id)
        if not allowed:
            return None

    # --- write log ---
    log_entry = EmailLog(
        user_id=user_id,
        tournament_id=tournament_id,
        email_type=email_type,
        subject=subject,
        to_address=to_address,
        body_html=body_html,
        simulated=simulated,
        status="queued",
    )
    db.add(log_entry)
    await db.flush()  # get id

    if not simulated:
        success, resend_id = await _send_via_resend(to_address, subject, body_html)
        log_entry.status = "sent" if success else "failed"
        log_entry.resend_message_id = resend_id
        log_entry.sent_at = datetime.now(timezone.utc) if success else None
    else:
        log_entry.status = "queued"

    await db.commit()
    await db.refresh(log_entry)
    return log_entry


async def send_broadcast_direct(
    db: AsyncSession,
    *,
    user_id: int,
    to_address: str,
    subject: str,
    body_html: str,
    simulated: bool,
) -> EmailLog:
    """Send a broadcast email with caller-supplied subject/body (no template rendering)."""
    log_entry = EmailLog(
        user_id=user_id,
        tournament_id=None,
        email_type=EmailType.broadcast,
        subject=subject,
        to_address=to_address,
        body_html=body_html,
        simulated=simulated,
        status="queued",
    )
    db.add(log_entry)
    await db.flush()

    if not simulated:
        success, resend_id = await _send_via_resend(to_address, subject, body_html)
        log_entry.status = "sent" if success else "failed"
        log_entry.resend_message_id = resend_id
        log_entry.sent_at = datetime.now(timezone.utc) if success else None

    await db.commit()
    await db.refresh(log_entry)
    return log_entry


async def deliver_log_entry(db: AsyncSession, log_id: int) -> EmailLog | None:
    """Send a previously-simulated log entry for real via Resend."""
    log_res = await db.execute(select(EmailLog).where(EmailLog.id == log_id))
    entry = log_res.scalar_one_or_none()
    if entry is None:
        return None

    success, resend_id = await _send_via_resend(entry.to_address, entry.subject, entry.body_html)
    entry.simulated = False
    entry.status = "sent" if success else "failed"
    entry.resend_message_id = resend_id
    entry.sent_at = datetime.now(timezone.utc) if success else None
    await db.commit()
    await db.refresh(entry)
    return entry


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

async def _check_hierarchy(
    db: AsyncSession,
    user_id: int,
    email_type: EmailType,
    tournament_id: int | None,
) -> bool:
    from models.tournament_email_settings import TournamentEmailSettings
    from models.user_email_preference import UserEmailPreference
    from models.league_member import LeagueMember
    from models.league import League

    # Transactional types only need tournament = LIVE (already verified by caller)
    if email_type in TRANSACTIONAL_TYPES:
        return True

    if not tournament_id:
        return False

    # Type must be enabled for this tournament
    tes_res = await db.execute(
        select(TournamentEmailSettings).where(
            TournamentEmailSettings.tournament_id == tournament_id,
            TournamentEmailSettings.email_type == email_type,
        )
    )
    tes = tes_res.scalar_one_or_none()
    if not tes or not tes.enabled:
        return False

    # At least one of user's leagues in this tournament must have emails_enabled
    league_res = await db.execute(
        select(League)
        .join(LeagueMember, LeagueMember.league_id == League.id)
        .where(
            LeagueMember.user_id == user_id,
            League.tournament_id == tournament_id,
            League.emails_enabled == True,
        )
    )
    if not league_res.scalar_one_or_none():
        return False

    # User must have opted in for this type
    pref_res = await db.execute(
        select(UserEmailPreference).where(
            UserEmailPreference.user_id == user_id,
            UserEmailPreference.email_type == email_type,
        )
    )
    pref = pref_res.scalar_one_or_none()
    if not pref or not pref.opted_in:
        return False

    return True


def _render(template_str: str, context: dict[str, Any]) -> str:
    try:
        return _jinja_env.from_string(template_str).render(**context)
    except Exception as exc:
        logger.warning("Template render error: %s", exc)
        return template_str


async def _send_via_resend(to: str, subject: str, html: str) -> tuple[bool, str | None]:
    api_key = settings.TRANS_EMAIL_API_KEY
    from_address = await _get_from_address()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"from": from_address, "to": [to], "subject": subject, "html": html},
            )
        if resp.status_code in (200, 201):
            try:
                res_data = resp.json()
                return True, res_data.get("id")
            except Exception:
                return True, None
        logger.error("Resend API error %s: %s", resp.status_code, resp.text)
        return False, None
    except Exception as exc:
        logger.error("Resend send failed: %s", exc)
        return False, None


async def _get_from_address() -> str:
    """Read from_address from the settings table; fall back to a default."""
    from core.database import AsyncSessionLocal
    from models.setting import Setting
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(Setting).where(Setting.key == "email.from_address"))
            setting = res.scalar_one_or_none()
            if setting:
                return setting.value
    except Exception:
        pass
    return "noreply@worldcup-predictor.app"
