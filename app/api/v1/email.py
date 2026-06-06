"""
Admin email management API.

All endpoints require admin role except the Resend webhook (POST /email/webhook).

Routes:
  GET  /admin/email/config
  PUT  /admin/email/config
  GET  /admin/email/tournament-settings
  PUT  /admin/email/tournament-settings/{tournament_id}
  GET  /admin/email/leagues
  PUT  /admin/email/leagues/{league_id}
  GET  /admin/email/templates
  PUT  /admin/email/templates/{email_type}
  GET  /admin/email/log
  POST /admin/email/log/{log_id}/send
  POST /admin/email/test-send
  POST /admin/email/webhook          (Resend delivery events — no auth)
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete, func, exists, cast, Date, and_
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_current_admin
from models.user import User
from models.user_email_preference import UserEmailPreference
from models.tournament import Tournament, EmailMode
from models.league import League
from models.email_template import EmailTemplate, EmailType
from models.tournament_email_settings import TournamentEmailSettings
from models.email_log import EmailLog
from models.league_member import LeagueMember
from models.fixture import Fixture
from models.setting import Setting
from services import email_service

logger = logging.getLogger(__name__)
router = APIRouter()

EMAIL_TYPES = [e.value for e in EmailType]


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ConfigOut(BaseModel):
    resend_api_key_set: bool
    from_address: str
    tournaments: list[dict]


class ConfigUpdate(BaseModel):
    from_address: str
    resend_api_key: str | None = None  # None = keep existing


class TournamentModeUpdate(BaseModel):
    email_mode: str  # "simulation" | "live"


class TournamentSettingsOut(BaseModel):
    tournament_id: int
    tournament_name: str
    email_mode: str
    types: dict[str, bool]


class TournamentSettingsUpdate(BaseModel):
    types: dict[str, bool]


class LeagueEmailOut(BaseModel):
    id: int
    name: str
    tournament_id: int
    tournament_name: str
    emails_enabled: bool

    model_config = {"from_attributes": True}


class LeagueEmailUpdate(BaseModel):
    emails_enabled: bool


class TemplateOut(BaseModel):
    email_type: str
    subject: str
    body_html: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class TemplateUpdate(BaseModel):
    subject: str
    body_html: str


class LogEntryOut(BaseModel):
    id: int
    created_at: datetime
    email_type: str
    to_address: str
    display_name: str
    subject: str
    simulated: bool
    status: str
    sent_at: datetime | None
    body_html: str
    tournament_id: int | None


class TestSendRequest(BaseModel):
    email_type: str
    to_address: str | None = None


# ---------------------------------------------------------------------------
# GET /admin/email/config
# ---------------------------------------------------------------------------

@router.get("/config", response_model=ConfigOut)
async def get_email_config(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    from core.config import settings as app_settings

    res = await db.execute(select(Setting).where(Setting.key == "email.from_address"))
    from_addr_row = res.scalar_one_or_none()

    tournaments_res = await db.execute(select(Tournament).order_by(Tournament.id))
    tournaments = [
        {"id": t.id, "name": t.name, "email_mode": t.email_mode.value}
        for t in tournaments_res.scalars().all()
    ]

    return ConfigOut(
        resend_api_key_set=bool(app_settings.TRANS_EMAIL_API_KEY),
        from_address=from_addr_row.value if from_addr_row else "",
        tournaments=tournaments,
    )


# ---------------------------------------------------------------------------
# PUT /admin/email/config
# ---------------------------------------------------------------------------

@router.put("/config", response_model=dict)
async def update_email_config(
    payload: ConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    await _upsert_setting(db, "email.from_address", payload.from_address)
    # API key is in .env — we don't store it in DB; just acknowledge
    await db.commit()
    return {"message": "Config updated"}


# ---------------------------------------------------------------------------
# PUT /admin/email/tournaments/{tournament_id}/mode
# ---------------------------------------------------------------------------

@router.put("/tournaments/{tournament_id}/mode", response_model=dict)
async def set_tournament_email_mode(
    tournament_id: int,
    payload: TournamentModeUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if payload.email_mode not in ("simulation", "live"):
        raise HTTPException(status_code=422, detail="email_mode must be 'simulation' or 'live'")

    res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    tournament.email_mode = EmailMode(payload.email_mode)
    await db.commit()
    return {"message": "Tournament email mode updated", "email_mode": payload.email_mode}


# ---------------------------------------------------------------------------
# GET /admin/email/tournament-settings
# ---------------------------------------------------------------------------

@router.get("/tournament-settings", response_model=list[TournamentSettingsOut])
async def get_tournament_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    tournaments_res = await db.execute(select(Tournament).order_by(Tournament.id))
    tournaments = tournaments_res.scalars().all()

    settings_res = await db.execute(select(TournamentEmailSettings))
    all_settings = settings_res.scalars().all()
    settings_map: dict[tuple, bool] = {}
    for s in all_settings:
        try:
            settings_map[(s.tournament_id, s.email_type.value)] = s.enabled
        except (ValueError, AttributeError):
            pass  # stale enum value in DB; skip rather than crash

    out = []
    for t in tournaments:
        types = {et: settings_map.get((t.id, et), False) for et in EMAIL_TYPES}
        out.append(TournamentSettingsOut(
            tournament_id=t.id,
            tournament_name=t.name,
            email_mode=t.email_mode.value,
            types=types,
        ))
    return out


# ---------------------------------------------------------------------------
# PUT /admin/email/tournament-settings/{tournament_id}
# ---------------------------------------------------------------------------

@router.put("/tournament-settings/{tournament_id}", response_model=dict)
async def update_tournament_settings(
    tournament_id: int,
    payload: TournamentSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    t_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    if not t_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Tournament not found")

    for type_str, enabled in payload.types.items():
        if type_str not in EMAIL_TYPES:
            continue
        email_type = EmailType(type_str)
        existing = await db.execute(
            select(TournamentEmailSettings).where(
                TournamentEmailSettings.tournament_id == tournament_id,
                TournamentEmailSettings.email_type == email_type,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.enabled = enabled
        else:
            db.add(TournamentEmailSettings(
                tournament_id=tournament_id,
                email_type=email_type,
                enabled=enabled,
            ))

    await db.commit()
    return {"message": "Tournament email settings updated"}


# ---------------------------------------------------------------------------
# GET /admin/email/leagues
# ---------------------------------------------------------------------------

@router.get("/leagues", response_model=list[LeagueEmailOut])
async def get_league_email_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(
        select(League, Tournament)
        .join(Tournament, League.tournament_id == Tournament.id)
        .order_by(Tournament.id, League.id)
    )
    rows = res.all()
    return [
        LeagueEmailOut(
            id=league.id,
            name=league.name,
            tournament_id=tournament.id,
            tournament_name=tournament.name,
            emails_enabled=league.emails_enabled,
        )
        for league, tournament in rows
    ]


# ---------------------------------------------------------------------------
# PUT /admin/email/leagues/{league_id}
# ---------------------------------------------------------------------------

@router.put("/leagues/{league_id}", response_model=dict)
async def update_league_email_setting(
    league_id: int,
    payload: LeagueEmailUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(select(League).where(League.id == league_id))
    league = res.scalar_one_or_none()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    league.emails_enabled = payload.emails_enabled
    await db.commit()
    return {"message": "League email setting updated"}


# ---------------------------------------------------------------------------
# GET /admin/email/templates
# ---------------------------------------------------------------------------

@router.get("/templates", response_model=list[TemplateOut])
async def get_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(select(EmailTemplate).order_by(EmailTemplate.id))
    return res.scalars().all()


# ---------------------------------------------------------------------------
# PUT /admin/email/templates/{email_type}
# ---------------------------------------------------------------------------

@router.put("/templates/{email_type}", response_model=TemplateOut)
async def update_template(
    email_type: str,
    payload: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if email_type not in EMAIL_TYPES:
        raise HTTPException(status_code=404, detail="Unknown email type")

    res = await db.execute(
        select(EmailTemplate).where(EmailTemplate.email_type == EmailType(email_type))
    )
    template = res.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found — run migrations")

    template.subject = payload.subject
    template.body_html = payload.body_html
    template.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(template)
    return template


# ---------------------------------------------------------------------------
# GET /admin/email/log
# ---------------------------------------------------------------------------

@router.get("/log", response_model=list[LogEntryOut])
async def get_email_log(
    email_type: str | None = None,
    simulated: bool | None = None,
    status: str | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    stmt = (
        select(EmailLog, User)
        .join(User, EmailLog.user_id == User.id)
        .order_by(EmailLog.created_at.desc())
        .limit(min(limit, 500))
    )
    if email_type:
        stmt = stmt.where(EmailLog.email_type == EmailType(email_type))
    if simulated is not None:
        stmt = stmt.where(EmailLog.simulated == simulated)
    if status:
        stmt = stmt.where(EmailLog.status == status)

    res = await db.execute(stmt)
    rows = res.all()
    return [
        LogEntryOut(
            id=log.id,
            created_at=log.created_at,
            email_type=log.email_type.value,
            to_address=log.to_address,
            display_name=user.display_name,
            subject=log.subject,
            simulated=log.simulated,
            status=log.status,
            sent_at=log.sent_at,
            body_html=log.body_html,
            tournament_id=log.tournament_id,
        )
        for log, user in rows
    ]


# ---------------------------------------------------------------------------
# POST /admin/email/log/{log_id}/send
# ---------------------------------------------------------------------------

@router.post("/log/{log_id}/send", response_model=dict)
async def send_log_entry(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    entry = await email_service.deliver_log_entry(db, log_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return {"message": "Email dispatched", "status": entry.status}


# ---------------------------------------------------------------------------
# POST /admin/email/test-send
# ---------------------------------------------------------------------------

@router.post("/test-send", response_model=dict)
async def test_send(
    payload: TestSendRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    if payload.email_type not in EMAIL_TYPES:
        raise HTTPException(status_code=422, detail="Unknown email type")

    # Find a tournament to associate with the test send to determine if it should send for real
    t_res = await db.execute(
        select(Tournament).where(Tournament.email_mode == EmailMode.live).limit(1)
    )
    tournament = t_res.scalar_one_or_none()
    if not tournament:
        t_res = await db.execute(select(Tournament).limit(1))
        tournament = t_res.scalar_one_or_none()
    tournament_id = tournament.id if tournament else None

    dummy_context = _dummy_context(payload.email_type)
    entry = await email_service.send_email(
        db,
        user_id=current_admin.id,
        to_address=payload.to_address or current_admin.email,
        email_type=EmailType(payload.email_type),
        context=dummy_context,
        tournament_id=tournament_id,
        bypass_hierarchy=True,
    )
    if not entry:
        raise HTTPException(status_code=500, detail="Failed to generate email")

    return {"message": f"Test email dispatched (simulated={entry.simulated})", "log_id": entry.id}


# ---------------------------------------------------------------------------
# POST /email/webhook  (Resend delivery events)
# ---------------------------------------------------------------------------

def _verify_resend_signature(payload: bytes, svix_id: str, svix_ts: str, svix_signature: str, secret: str) -> bool:
    """Verify Resend/Svix webhook signature.

    Svix signs: "{svix_id}.{svix_timestamp}.{body}" with HMAC-SHA256.
    The secret is base64-encoded after the "whsec_" prefix.
    """
    import base64
    try:
        raw_secret = base64.b64decode(secret.removeprefix("whsec_"))
    except Exception:
        return False
    signed_content = f"{svix_id}.{svix_ts}.".encode() + payload
    expected = base64.b64encode(
        hmac.new(raw_secret, signed_content, hashlib.sha256).digest()
    ).decode()
    # Svix sends comma-separated list of "v1,<sig>" values; any match is valid
    for part in svix_signature.split(" "):
        if part.startswith("v1,") and hmac.compare_digest(part[3:], expected):
            return True
    return False


@router.post("/webhook", include_in_schema=False)
async def resend_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Update email_log.status from Resend delivery/bounce events."""
    from core.config import settings as app_settings
    raw_body = await request.body()

    webhook_secret = getattr(app_settings, "RESEND_WEBHOOK_SECRET", None)
    if webhook_secret:
        svix_id  = request.headers.get("svix-id", "")
        svix_ts  = request.headers.get("svix-timestamp", "")
        svix_sig = request.headers.get("svix-signature", "")
        if not _verify_resend_signature(raw_body, svix_id, svix_ts, svix_sig, webhook_secret):
            logger.warning("Resend webhook: invalid signature — request rejected")
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        import json
        body: dict[str, Any] = json.loads(raw_body)
    except Exception:
        return {"ok": False}

    event_type = body.get("type", "")
    data = body.get("data", {})
    resend_id = data.get("email_id") or data.get("id")
    if not resend_id:
        return {"ok": True}

    # Map Resend event types to our status values
    status_map = {
        "email.delivered": "sent",
        "email.bounced": "bounced",
        "email.delivery_delayed": "queued",
        "email.complained": "bounced",
    }
    new_status = status_map.get(event_type)
    if not new_status:
        return {"ok": True}

    logger.info("Resend webhook: %s for %s", event_type, resend_id)

    from models.email_log import EmailLog
    from datetime import datetime, timezone

    stmt = select(EmailLog).where(EmailLog.resend_message_id == resend_id)
    res = await db.execute(stmt)
    entry = res.scalar_one_or_none()
    if entry:
        entry.status = new_status
        if new_status == "sent" and not entry.sent_at:
            entry.sent_at = datetime.now(timezone.utc)
        await db.commit()
        logger.info("Updated EmailLog id=%d to status=%s", entry.id, new_status)
    else:
        logger.warning("No EmailLog entry found for resend_message_id=%s", resend_id)

    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /admin/email/user-preferences
# ---------------------------------------------------------------------------

@router.get("/user-preferences", response_model=list[dict])
async def get_user_email_preferences(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    users_res = await db.execute(select(User).order_by(User.display_name))
    users = users_res.scalars().all()

    prefs_res = await db.execute(select(UserEmailPreference))
    prefs_map: dict[tuple, bool] = {
        (p.user_id, p.email_type.value): p.opted_in for p in prefs_res.scalars().all()
    }

    return [
        {
            "user_id": u.id,
            "display_name": u.display_name,
            "email": u.email,
            "is_active": u.is_active,
            "preferences": {
                et: prefs_map.get((u.id, et), False) for et in EMAIL_TYPES
            },
        }
        for u in users
    ]


# ---------------------------------------------------------------------------
# GET /admin/email/send-estimates
# ---------------------------------------------------------------------------

TRANSACTIONAL_TYPES = {"welcome"}


@router.get("/send-estimates", response_model=list[dict])
async def get_send_estimates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Return estimated total email sends per (tournament_id, email_type).

    Transactional types (welcome) fire once per user event so
    the estimate is simply the number of eligible active users.

    Marketing types are multiplied by how many times they fire across the
    tournament:
      - round_summary: fires once per round, where a round = a distinct
        (stage, matchday) pair in the fixtures table.
      - daily_digest:  fires once per day that has at least one fixture.

    Marketing eligibility requires: active user + opted-in + member of at
    least one emails-enabled league in the tournament.
    """
    tournaments_res = await db.execute(select(Tournament).order_by(Tournament.id))
    tournaments = tournaments_res.scalars().all()

    out = []
    for t in tournaments:
        # ------------------------------------------------------------------
        # User audience counts
        # ------------------------------------------------------------------

        # Active users in any league of this tournament (transactional)
        in_tournament_sq = (
            select(LeagueMember.user_id)
            .join(League, League.id == LeagueMember.league_id)
            .where(League.tournament_id == t.id)
            .distinct()
            .scalar_subquery()
        )

        # Active users in an emails-enabled league (marketing baseline)
        in_enabled_league_sq = (
            select(LeagueMember.user_id)
            .join(League, League.id == LeagueMember.league_id)
            .where(
                League.tournament_id == t.id,
                League.emails_enabled.is_(True),
            )
            .distinct()
            .scalar_subquery()
        )

        def opted_in_exists(et: str):
            return exists(
                select(UserEmailPreference.id).where(
                    UserEmailPreference.user_id == User.id,
                    UserEmailPreference.email_type == EmailType(et),
                    UserEmailPreference.opted_in.is_(True),
                )
            )

        transactional_users_res = await db.execute(
            select(func.count(User.id)).where(
                User.is_active.is_(True),
                User.id.in_(in_tournament_sq),
            )
        )
        transactional_users: int = transactional_users_res.scalar_one()

        marketing_users: dict[str, int] = {}
        for et in EMAIL_TYPES:
            if et in TRANSACTIONAL_TYPES:
                continue
            res = await db.execute(
                select(func.count(User.id)).where(
                    User.is_active.is_(True),
                    User.id.in_(in_enabled_league_sq),
                    opted_in_exists(et),
                )
            )
            marketing_users[et] = res.scalar_one()

        # ------------------------------------------------------------------
        # Fixture-based multipliers
        # ------------------------------------------------------------------

        # Number of distinct rounds = distinct (stage, matchday) pairs
        rounds_subq = (
            select(Fixture.stage, Fixture.matchday)
            .where(Fixture.tournament_id == t.id)
            .distinct()
            .subquery()
        )
        rounds_res = await db.execute(select(func.count()).select_from(rounds_subq))
        num_rounds: int = rounds_res.scalar_one() or 1

        # Number of distinct fixture days
        days_subq = (
            select(cast(Fixture.kickoff_time, Date))
            .where(Fixture.tournament_id == t.id)
            .distinct()
            .subquery()
        )
        days_res = await db.execute(select(func.count()).select_from(days_subq))
        num_days: int = days_res.scalar_one() or 1

        # ------------------------------------------------------------------
        # Assemble estimates
        # ------------------------------------------------------------------
        multipliers = {
            "round_summary": num_rounds,
            "daily_digest": num_days,
        }

        type_counts: dict[str, int] = {}
        for et in EMAIL_TYPES:
            if et in TRANSACTIONAL_TYPES:
                type_counts[et] = transactional_users
            else:
                type_counts[et] = marketing_users[et] * multipliers.get(et, 1)

        out.append({
            "tournament_id": t.id,
            "counts": type_counts,
            "multipliers": {"rounds": num_rounds, "days": num_days},
        })

    return out


# ---------------------------------------------------------------------------
# POST /admin/email/broadcast/preview
# ---------------------------------------------------------------------------

MARKETING_TYPES = [EmailType.round_summary, EmailType.daily_digest]


class BroadcastPreviewRequest(BaseModel):
    league_ids: list[int] | None = None  # None = all eligible leagues


class BroadcastRecipient(BaseModel):
    user_id: int
    display_name: str
    email: str
    leagues: list[str]


class BroadcastPreviewOut(BaseModel):
    recipients: list[BroadcastRecipient]
    total: int
    simulated: bool


@router.post("/broadcast/preview", response_model=BroadcastPreviewOut)
async def broadcast_preview(
    payload: BroadcastPreviewRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    recipients, simulated = await _resolve_broadcast(db, payload.league_ids)
    return BroadcastPreviewOut(recipients=recipients, total=len(recipients), simulated=simulated)


# ---------------------------------------------------------------------------
# POST /admin/email/broadcast/send
# ---------------------------------------------------------------------------

class BroadcastSendRequest(BaseModel):
    subject: str
    body_html: str
    league_ids: list[int] | None = None
    force_live: bool = False


class BroadcastSendOut(BaseModel):
    sent: int
    failed: int
    simulated: bool


@router.post("/broadcast/send", response_model=BroadcastSendOut)
async def broadcast_send(
    payload: BroadcastSendRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if not payload.subject.strip():
        raise HTTPException(status_code=422, detail="Subject is required")
    if not payload.body_html.strip():
        raise HTTPException(status_code=422, detail="Body is required")

    from core.database import AsyncSessionLocal
    import asyncio

    recipients, simulated = await _resolve_broadcast(db, payload.league_ids)
    if payload.force_live:
        simulated = False

    async def send_one(r) -> bool:
        async with AsyncSessionLocal() as local_db:
            try:
                entry = await email_service.send_broadcast_direct(
                    local_db,
                    user_id=r.user_id,
                    to_address=r.email,
                    subject=payload.subject,
                    body_html=payload.body_html,
                    simulated=simulated,
                )
                return entry.status in ("sent", "queued")
            except Exception as exc:
                logger.error("Failed to send broadcast to %s: %s", r.email, exc)
                return False

    sem = asyncio.Semaphore(10)

    async def worker(r) -> bool:
        async with sem:
            return await send_one(r)

    results = await asyncio.gather(*(worker(r) for r in recipients))
    sent = sum(1 for res in results if res)
    failed = len(results) - sent

    return BroadcastSendOut(sent=sent, failed=failed, simulated=simulated)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _resolve_broadcast(
    db: AsyncSession,
    league_ids: list[int] | None,
) -> tuple[list[BroadcastRecipient], bool]:
    """Return (recipients, simulated) for a broadcast."""
    # Opted-in to any marketing type
    opted_in_sq = (
        select(UserEmailPreference.user_id)
        .where(
            UserEmailPreference.opted_in.is_(True),
            UserEmailPreference.email_type.in_(MARKETING_TYPES),
        )
        .distinct()
        .scalar_subquery()
    )

    # In at least one emails-enabled league (filtered by league_ids if provided)
    league_cond = League.emails_enabled.is_(True)
    if league_ids:
        league_cond = and_(league_cond, League.id.in_(league_ids))

    in_league_sq = (
        select(LeagueMember.user_id)
        .join(League, League.id == LeagueMember.league_id)
        .where(league_cond)
        .distinct()
        .scalar_subquery()
    )

    users_res = await db.execute(
        select(User)
        .where(
            User.is_active.is_(True),
            User.id.in_(opted_in_sq),
            User.id.in_(in_league_sq),
        )
        .order_by(User.display_name)
    )
    users = users_res.scalars().all()

    # Fetch league names per user in one query
    league_name_res = await db.execute(
        select(LeagueMember.user_id, League.name)
        .join(League, League.id == LeagueMember.league_id)
        .where(
            LeagueMember.user_id.in_([u.id for u in users]),
            league_cond,
        )
    )
    user_leagues: dict[int, list[str]] = {}
    for uid, lname in league_name_res.all():
        user_leagues.setdefault(uid, []).append(lname)

    recipients = [
        BroadcastRecipient(
            user_id=u.id,
            display_name=u.display_name,
            email=u.email,
            leagues=user_leagues.get(u.id, []),
        )
        for u in users
    ]

    # Simulation: live if any active tournament is in live mode
    from models.tournament import Tournament
    live_res = await db.execute(
        select(Tournament).where(
            Tournament.is_active.is_(True),
            Tournament.email_mode == "live",
        ).limit(1)
    )
    simulated = live_res.scalar_one_or_none() is None

    return recipients, simulated


# ---------------------------------------------------------------------------
# GET /admin/email/quota
# ---------------------------------------------------------------------------

class QuotaOut(BaseModel):
    available: bool          # False if API key not set
    used: int | None         # emails sent this month (from Resend header)
    limit: int               # configured plan limit (from DB setting, default 3000)
    error: str | None = None # set if the probe call failed


class MonthlyLimitUpdate(BaseModel):
    limit: int


@router.get("/quota", response_model=QuotaOut)
async def get_email_quota(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Probe Resend's list-emails endpoint with limit=1 and read the
    x-resend-monthly-quota header to return sent / remaining counts.
    The monthly plan cap is stored as the 'email.monthly_limit' DB setting
    (default 3000 — Resend free tier).
    """
    from core.config import settings as app_settings

    # Fetch configured limit
    res = await db.execute(select(Setting).where(Setting.key == "email.monthly_limit"))
    limit_row = res.scalar_one_or_none()
    limit = int(limit_row.value) if limit_row else 3000

    if not app_settings.TRANS_EMAIL_API_KEY:
        return QuotaOut(available=False, used=None, limit=limit)

    import httpx
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.resend.com/emails",
                params={"limit": 1},
                headers={"Authorization": f"Bearer {app_settings.TRANS_EMAIL_API_KEY}"},
            )
        quota_header = resp.headers.get("x-resend-monthly-quota")
        used = int(quota_header) if quota_header is not None else None
        return QuotaOut(available=True, used=used, limit=limit)
    except Exception as exc:
        logger.warning("Resend quota probe failed: %s", exc)
        return QuotaOut(available=True, used=None, limit=limit, error=str(exc))


@router.put("/monthly-limit", response_model=dict)
async def set_monthly_limit(
    payload: MonthlyLimitUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Persist the admin-configured Resend monthly send limit."""
    if payload.limit < 1:
        raise HTTPException(status_code=422, detail="limit must be >= 1")
    await _upsert_setting(db, "email.monthly_limit", str(payload.limit))
    await db.commit()
    return {"message": "Monthly limit updated", "limit": payload.limit}


async def _upsert_setting(db: AsyncSession, key: str, value: str) -> None:
    res = await db.execute(select(Setting).where(Setting.key == key))
    row = res.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def _dummy_context(email_type: str) -> dict:
    base = {
        "user_name": "Test User",
        "site_url": "http://localhost:8083",
        "tournament_name": "World Cup 2026",
    }
    if email_type == "welcome":
        return base
    if email_type in ("round_summary", "daily_digest"):
        return {
            **base,
            "round_name": "Group Stage — Matchday 1",
            "digest_date": "Saturday 13 Jun",
            "matches": [
                {"home_team": "USA", "away_team": "MEX", "home_score": 2, "away_score": 1,
                 "predicted_home": 1, "predicted_away": 0, "points": 1},
            ],
            "leagues": [
                {"name": "Test League", "rank": 3, "movement": 2},
            ],
            "next_round_name": "Group Stage — Matchday 2",
            "next_round_lock_time": "Wed 17 Jun at 14:00 UTC",
            "upcoming_fixtures": [
                {"home_team": "ENG", "away_team": "ARG", "kickoff_time": "Wed 17 Jun 14:00"},
            ],
        }
    return base
