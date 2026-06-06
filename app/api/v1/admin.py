"""
Admin API router.

Endpoints (all require admin role):
  GET  /admin/users                  - List all users with their permissions
  PUT  /admin/users/{id}/role        - Update a user's role and granular permissions
  POST /admin/sync-fixtures          - Trigger live fixture sync (Redis mutex protected)
  GET  /admin/invitations            - List pending (unclaimed) invitation tokens
  POST /admin/invitations            - Generate a new invitation token for a league
  DELETE /admin/invitations/{token}  - Revoke a pending invitation
  GET  /admin/build-info             - System build/health dashboard stats
"""

from __future__ import annotations

import os
import time
import secrets
import logging
import enum
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_current_admin, get_current_user
from core.config import settings
from models.user import User, UserRole
from models.league import League
from models.league_member import LeagueMember
from models.invitation import Invitation
from core.redis_client import redis_client
from services.leaderboard import update_user_score

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class UserSummary(BaseModel):
    id: int
    email: str
    display_name: str
    role: str
    is_active: bool
    can_manage_leagues: bool
    can_manage_tournaments: bool
    can_invite_users: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UpdateRoleRequest(BaseModel):
    role: str  # "admin" | "player"
    can_manage_leagues: bool
    can_manage_tournaments: bool
    can_invite_users: bool
    is_active: bool


class SyncResult(BaseModel):
    inserted: int
    updated: int
    skipped: int
    total: int
    api_calls_used: int


class InvitationOut(BaseModel):
    token: str
    league_id: int
    league_name: str
    created_at: str


class CreateInvitationRequest(BaseModel):
    league_id: int


# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[UserSummary])
async def list_all_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Return all users ordered by total_points descending."""
    result = await db.execute(select(User).order_by(User.total_points.desc()))
    return result.scalars().all()


# ---------------------------------------------------------------------------
# PUT /admin/users/{user_id}/role
# ---------------------------------------------------------------------------

@router.put("/users/{user_id}/role", response_model=UserSummary)
async def update_user_role(
    user_id: int,
    payload: UpdateRoleRequest,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Update a user's role and granular permissions."""
    if payload.role not in ("admin", "player"):
        raise HTTPException(status_code=422, detail="role must be 'admin' or 'player'")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent an admin from demoting themselves accidentally
    if user.id == current_admin.id and payload.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="You cannot demote your own account. Ask another admin to do this.",
        )

    user.role = UserRole.admin if payload.role == "admin" else UserRole.player
    user.can_manage_leagues = payload.can_manage_leagues
    user.can_manage_tournaments = payload.can_manage_tournaments
    user.can_invite_users = payload.can_invite_users
    user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# POST /admin/sync-fixtures
# ---------------------------------------------------------------------------

SYNC_LOCK_KEY = "admin:sync-fixtures:lock"
SYNC_LOCK_TTL = 120  # seconds


@router.post("/sync-fixtures", response_model=SyncResult)
async def trigger_fixture_sync(
    _: User = Depends(get_current_admin),
):
    """
    Trigger a full fixture sync with API-Football.

    Protected by a Redis NX mutual-exclusion lock (TTL=120 s) so that
    double-clicking the button in the UI cannot launch two concurrent syncs.

    Returns an idempotent count matrix: inserted / updated / skipped / total.
    """
    # --- Redis mutex: acquire lock ---
    acquired = await redis_client.set(SYNC_LOCK_KEY, "1", nx=True, ex=SYNC_LOCK_TTL)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A sync is already in progress. Please wait and try again.",
        )

    try:
        from workers.sports_poller import perform_sync_with_stats
        result = await perform_sync_with_stats()
        return result
    except Exception as exc:
        logger.exception("Sync failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc
    finally:
        # Always release the lock
        await redis_client.delete(SYNC_LOCK_KEY)


# ---------------------------------------------------------------------------
# POST /admin/points/recalculate
# Rebuild User.total_points from the ledger and resync Redis leaderboards.
# ---------------------------------------------------------------------------

@router.post("/points/recalculate", response_model=dict)
async def trigger_points_recalculate(
    user_id: int | None = None,
    _: User = Depends(get_current_admin),
):
    """
    Reconciliation endpoint. With no `user_id` query param, rebuilds every
    user's total_points from `user_points_ledger` and resyncs all Redis
    leaderboard sorted sets. With `user_id`, runs the single-user variant.

    Idempotent — safe to invoke at any time.
    """
    from workers.points_recalc import _recalculate_all, _recalculate_user

    if user_id is not None:
        return await _recalculate_user(user_id)
    return await _recalculate_all()


# ---------------------------------------------------------------------------
# GET /admin/invitations  (pending / unclaimed tokens)
# ---------------------------------------------------------------------------

@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return all invitations that are not claimed, not revoked, and not expired.
    Also falls back to listing leagues that still have legacy invite_token.
    """
    if current_user.role != UserRole.admin and not current_user.can_manage_leagues:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Fetch from invitations table
    stmt = (
        select(Invitation, League)
        .join(League, Invitation.league_id == League.id)
        .where(
            Invitation.claimed_by.is_(None),
            Invitation.is_revoked == False
        )
    )
    if current_user.role != UserRole.admin:
        stmt = stmt.where(League.created_by == current_user.id)

    result = await db.execute(stmt)
    rows = result.all()
    out = []
    seen_tokens = set()
    for invitation, league in rows:
        # Check if expired
        if invitation.expires_at and datetime.now(timezone.utc) > invitation.expires_at:
            continue
        seen_tokens.add(invitation.token)
        out.append(
            InvitationOut(
                token=invitation.token,
                league_id=league.id,
                league_name=league.name,
                created_at=invitation.created_at.isoformat(),
            )
        )
        
    # Also fetch legacy league invite tokens for backward compatibility
    legacy_stmt = select(League).where(League.invite_token.isnot(None), League.is_active == True)
    if current_user.role != UserRole.admin:
        legacy_stmt = legacy_stmt.where(League.created_by == current_user.id)

    legacy_result = await db.execute(legacy_stmt)
    legacy_leagues = legacy_result.scalars().all()
    for league in legacy_leagues:
        if league.invite_token not in seen_tokens:
            out.append(
                InvitationOut(
                    token=league.invite_token,
                    league_id=league.id,
                    league_name=league.name,
                    created_at=league.created_at.isoformat() if hasattr(league, "created_at") and league.created_at else datetime.now(timezone.utc).isoformat(),
                )
            )
    return out


# ---------------------------------------------------------------------------
# POST /admin/invitations  (generate a fresh invite token for a league)
# ---------------------------------------------------------------------------

@router.post("/invitations", response_model=InvitationOut, status_code=201)
async def create_invitation(
    payload: CreateInvitationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a new unique UUID/URL-safe invitation token for a league using the invitations table."""
    if current_user.role != UserRole.admin and not current_user.can_manage_leagues:
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(select(League).where(League.id == payload.league_id))
    league = result.scalar_one_or_none()
    if league is None:
        raise HTTPException(status_code=404, detail="League not found")

    if current_user.role != UserRole.admin and league.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to invite for this league")

    new_token = f"inv-{secrets.token_urlsafe(24)}"
    invitation = Invitation(
        token=new_token,
        league_id=league.id,
        created_by=current_user.id,
        is_revoked=False
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    return InvitationOut(
        token=new_token,
        league_id=league.id,
        league_name=league.name,
        created_at=invitation.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# DELETE /admin/invitations/{token}  (revoke)
# ---------------------------------------------------------------------------

@router.delete("/invitations/{token}", status_code=204)
async def revoke_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke (mark as revoked) an invitation token."""
    if current_user.role != UserRole.admin and not current_user.can_manage_leagues:
        raise HTTPException(status_code=403, detail="Not authorized")

    result = await db.execute(select(Invitation).where(Invitation.token == token))
    invitation = result.scalar_one_or_none()
    if invitation is not None:
        # Check if they own the league
        result_league = await db.execute(select(League).where(League.id == invitation.league_id))
        league = result_league.scalar_one_or_none()
        if not league:
            raise HTTPException(status_code=404, detail="League not found")
        if current_user.role != UserRole.admin and league.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to revoke this invitation")

        invitation.is_revoked = True
        await db.commit()
        return

    # Fallback to legacy
    result_legacy = await db.execute(select(League).where(League.invite_token == token))
    league = result_legacy.scalar_one_or_none()
    if league is None:
        raise HTTPException(status_code=404, detail="Invitation token not found")

    if current_user.role != UserRole.admin and league.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to revoke this invitation")

    league.invite_token = None
    await db.commit()


# ---------------------------------------------------------------------------
# Additional Extended Schemas
# ---------------------------------------------------------------------------
class LeagueDetail(BaseModel):
    id: int
    name: str
    joined_at: str

class TournamentDetail(BaseModel):
    id: int
    name: str
    leagues: list[LeagueDetail]

class UserDetailOut(BaseModel):
    id: int
    display_name: str
    email: str
    tournaments: list[TournamentDetail]

class StageCompletion(BaseModel):
    predicted: int
    total: int

class UserCompletion(BaseModel):
    user_id: int
    display_name: str
    email: str
    group: StageCompletion
    round_32: StageCompletion
    round_16: StageCompletion
    quarter_final: StageCompletion
    semi_final: StageCompletion
    third_place: StageCompletion
    final: StageCompletion
    group_bracket_picks: StageCompletion
    ko_bracket_picks: StageCompletion

class TournamentCompletionResponse(BaseModel):
    tournament_id: int
    has_bracket: bool
    users: list[UserCompletion]

class SettingItem(BaseModel):
    key: str
    value: str

class SettingsUpdate(BaseModel):
    site_address: str
    live_sync_interval: str | None = "5"


class CreateTournamentRequest(BaseModel):
    name: str
    api_league_id: int | None = None
    api_season: int | None = None
    is_active: bool = True
    has_bracket: bool | None = None

class UpdateTournamentRequest(BaseModel):
    name: str
    api_league_id: int | None = None
    api_season: int | None = None
    is_active: bool
    has_bracket: bool

class TournamentOut(BaseModel):
    id: int
    name: str
    is_active: bool
    has_bracket: bool
    api_league_id: int | None
    api_season: int | None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# User Details & Groups
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}/details", response_model=UserDetailOut)
async def get_user_details(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Get full user details showing their registered leagues nested under their respective tournaments."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    from models.league_member import LeagueMember
    from models.tournament import Tournament

    stmt = (
        select(LeagueMember.joined_at, League, Tournament)
        .join(League, LeagueMember.league_id == League.id)
        .join(Tournament, League.tournament_id == Tournament.id)
        .where(LeagueMember.user_id == user_id)
    )
    rows_res = await db.execute(stmt)
    rows = rows_res.all()

    tournaments_map = {}
    for joined_at, league, tournament in rows:
        if tournament.id not in tournaments_map:
            tournaments_map[tournament.id] = {
                "id": tournament.id,
                "name": tournament.name,
                "leagues": []
            }
        tournaments_map[tournament.id]["leagues"].append(
            LeagueDetail(
                id=league.id,
                name=league.name,
                joined_at=joined_at.isoformat()
            )
        )

    return UserDetailOut(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        tournaments=[TournamentDetail(**t) for t in tournaments_map.values()]
    )


@router.get("/tournaments/{tournament_id}/users-completion", response_model=TournamentCompletionResponse)
async def get_tournament_users_completion(
    tournament_id: int,
    league_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Get completion statistics of all users against stages for a given tournament."""
    from models.tournament import Tournament
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from models.league_member import LeagueMember
    from sqlalchemy import select, func as sa_func

    # 1. Fetch tournament
    res_t = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res_t.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # 2. Get total fixtures per stage in this tournament
    res_f = await db.execute(
        select(Fixture.stage, sa_func.count(Fixture.id))
        .where(Fixture.tournament_id == tournament_id)
        .group_by(Fixture.stage)
    )
    total_fixtures = {stage.value: count for stage, count in res_f.all()}

    # Helper to get total count
    def get_total_for_stage(stage_val: str) -> int:
        return total_fixtures.get(stage_val, 0)

    # 3. Get all users
    stmt_u = select(User).order_by(User.display_name.asc())
    if league_id is not None:
        stmt_u = stmt_u.join(LeagueMember, LeagueMember.user_id == User.id).where(LeagueMember.league_id == league_id)
    res_u = await db.execute(stmt_u)
    users = res_u.scalars().all()

    # 4. Get match prediction counts per user and stage for this tournament
    res_p = await db.execute(
        select(
            MatchPrediction.user_id,
            Fixture.stage,
            sa_func.count(MatchPrediction.id)
        )
        .join(Fixture, MatchPrediction.fixture_id == Fixture.id)
        .where(Fixture.tournament_id == tournament_id)
        .group_by(MatchPrediction.user_id, Fixture.stage)
    )
    user_pred_counts = {}
    for user_id, stage, count in res_p.all():
        if user_id not in user_pred_counts:
            user_pred_counts[user_id] = {}
        user_pred_counts[user_id][stage.value] = count

    # 5. Get group bracket pick counts per user for this tournament
    res_gb = await db.execute(
        select(BracketPrediction.user_id, sa_func.count(BracketGroupPick.id))
        .join(BracketGroupPick, BracketGroupPick.bracket_id == BracketPrediction.id)
        .where(BracketPrediction.tournament_id == tournament_id)
        .group_by(BracketPrediction.user_id)
    )
    user_gb_counts = {user_id: count for user_id, count in res_gb.all()}

    # 6. Get KO bracket pick counts per user for this tournament
    res_kb = await db.execute(
        select(BracketPrediction.user_id, sa_func.count(BracketKoPick.id))
        .join(BracketKoPick, BracketKoPick.bracket_id == BracketPrediction.id)
        .where(BracketPrediction.tournament_id == tournament_id)
        .group_by(BracketPrediction.user_id)
    )
    user_kb_counts = {user_id: count for user_id, count in res_kb.all()}

    # Build response list
    user_completions = []
    for user in users:
        p_counts = user_pred_counts.get(user.id, {})
        user_completions.append(
            UserCompletion(
                user_id=user.id,
                display_name=user.display_name,
                email=user.email,
                group=StageCompletion(predicted=p_counts.get("group", 0), total=get_total_for_stage("group")),
                round_32=StageCompletion(predicted=p_counts.get("round_32", 0), total=get_total_for_stage("round_32")),
                round_16=StageCompletion(predicted=p_counts.get("round_16", 0), total=get_total_for_stage("round_16")),
                quarter_final=StageCompletion(predicted=p_counts.get("quarter_final", 0), total=get_total_for_stage("quarter_final")),
                semi_final=StageCompletion(predicted=p_counts.get("semi_final", 0), total=get_total_for_stage("semi_final")),
                third_place=StageCompletion(predicted=p_counts.get("third_place", 0), total=get_total_for_stage("third_place")),
                final=StageCompletion(predicted=p_counts.get("final", 0), total=get_total_for_stage("final")),
                group_bracket_picks=StageCompletion(predicted=user_gb_counts.get(user.id, 0), total=48),
                ko_bracket_picks=StageCompletion(predicted=user_kb_counts.get(user.id, 0), total=40),
            )
        )

    return TournamentCompletionResponse(
        tournament_id=tournament.id,
        has_bracket=tournament.has_bracket,
        users=user_completions,
    )





# ---------------------------------------------------------------------------
# Admin Settings
# ---------------------------------------------------------------------------
@router.get("/settings", response_model=list[SettingItem])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """List all customizable settings."""
    from models.setting import Setting
    res = await db.execute(select(Setting))
    items = list(res.scalars().all())
    
    # Ensure live_sync_interval is returned or seeded
    has_sync_interval = any(item.key == "live_sync_interval" for item in items)
    if not has_sync_interval:
        items.append(Setting(key="live_sync_interval", value="5"))
        
    return items


@router.put("/settings", response_model=dict)
async def update_settings(
    payload: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Update global configuration settings like site_address."""
    from models.setting import Setting
    
    # Update site_address
    res = await db.execute(select(Setting).where(Setting.key == "site_address"))
    setting = res.scalar_one_or_none()
    if not setting:
        setting = Setting(key="site_address", value=payload.site_address)
        db.add(setting)
    else:
        setting.value = payload.site_address

    # Update live_sync_interval
    if payload.live_sync_interval:
        res_sync = await db.execute(select(Setting).where(Setting.key == "live_sync_interval"))
        setting_sync = res_sync.scalar_one_or_none()
        if not setting_sync:
            setting_sync = Setting(key="live_sync_interval", value=payload.live_sync_interval)
            db.add(setting_sync)
        else:
            setting_sync.value = payload.live_sync_interval

    await db.commit()
    return {"message": "Settings updated successfully"}



# ---------------------------------------------------------------------------
# Bracket Auto-Discovery Helper (Decoupled Local Check)
# ---------------------------------------------------------------------------
@router.get("/tournaments/detect-bracket", response_model=dict)
async def autodiscover_bracket(
    api_league_id: int | None = None,
    api_season: int | None = None,
    _: User = Depends(get_current_admin),
):
    """Bypasses external APIs. World Cup (1) and Euro Cup (4) have brackets by default."""
    has_bracket = api_league_id in (1, 4) if api_league_id else False
    return {"has_bracket": has_bracket}


# ---------------------------------------------------------------------------
# Tournament Management APIs
# ---------------------------------------------------------------------------
@router.get("/tournaments", response_model=list[TournamentOut])
async def list_tournaments(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """List all tournaments for administration."""
    from models.tournament import Tournament
    res = await db.execute(select(Tournament).order_by(Tournament.id.asc()))
    return res.scalars().all()


@router.post("/tournaments", response_model=dict, status_code=201)
async def create_tournament(
    payload: CreateTournamentRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Add a new tournament with automatic bracket detection."""
    from models.tournament import Tournament

    has_bracket = payload.has_bracket
    if has_bracket is None:
        has_bracket = False

    tournament = Tournament(
        name=payload.name,
        is_active=payload.is_active,
        has_bracket=has_bracket,
        api_league_id=payload.api_league_id,
        api_season=payload.api_season
    )
    db.add(tournament)
    await db.commit()
    await db.refresh(tournament)

    return {
        "message": "Tournament created successfully",
        "id": tournament.id,
        "has_bracket": tournament.has_bracket
    }


@router.put("/tournaments/{tournament_id}", response_model=dict)
async def update_tournament(
    tournament_id: int,
    payload: UpdateTournamentRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Update tournament parameters."""
    from models.tournament import Tournament
    res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    tournament.name = payload.name
    tournament.api_league_id = payload.api_league_id
    tournament.api_season = payload.api_season
    tournament.is_active = payload.is_active
    tournament.has_bracket = payload.has_bracket

    await db.commit()
    return {"message": "Tournament updated successfully"}


@router.post("/tournaments/{tournament_id}/sync", response_model=SyncResult)
async def trigger_tournament_fixture_sync(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Trigger a fixture sync specifically targeted to a given tournament."""
    from models.tournament import Tournament
    res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # --- Redis mutex: acquire lock ---
    acquired = await redis_client.set(SYNC_LOCK_KEY, "1", nx=True, ex=SYNC_LOCK_TTL)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A sync is already in progress. Please wait and try again.",
        )

    try:
        from workers.sports_poller import perform_sync_with_stats
        result = await perform_sync_with_stats(
            league_id=None,
            season=None,
            tournament_id=tournament.id
        )
        return result
    except Exception as exc:
        logger.exception("Sync failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Sync failed: {exc}") from exc
    finally:
        # Always release the lock
        await redis_client.delete(SYNC_LOCK_KEY)


@router.post("/tournaments/{tournament_id}/reset", response_model=dict)
async def reset_and_rescrape_tournament(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Purges all predictions, bracket picks, and fixtures associated with this tournament,
    then executes a completely fresh scraped seeder.
    """
    from models.tournament import Tournament
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from core.initial_seed import seed
    from sqlalchemy import delete

    res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    try:
        # Stamp the reset time so submit_bracket rejects auto-saves in the cooldown window.
        tournament.predictions_reset_at = datetime.now(timezone.utc)

        # 1. Wipe the points ledger and rebuild user totals from remaining (other-tournament) rows.
        affected_user_ids = await _deduct_and_delete_ledger(db, tournament_id)

        # 2. Fetch all fixture IDs for this tournament
        stmt_fix = select(Fixture.id).where(Fixture.tournament_id == tournament_id)
        fixture_ids = (await db.execute(stmt_fix)).scalars().all()

        if fixture_ids:
            # Delete MatchPredictions
            stmt_del_preds = delete(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids))
            await db.execute(stmt_del_preds)

        # 3. Delete bracket picks and bracket predictions
        stmt_brackets = select(BracketPrediction.id).where(BracketPrediction.tournament_id == tournament_id)
        bracket_ids = (await db.execute(stmt_brackets)).scalars().all()

        if bracket_ids:
            stmt_del_g = delete(BracketGroupPick).where(BracketGroupPick.bracket_id.in_(bracket_ids))
            await db.execute(stmt_del_g)

            stmt_del_k = delete(BracketKoPick).where(BracketKoPick.bracket_id.in_(bracket_ids))
            await db.execute(stmt_del_k)

            stmt_del_b = delete(BracketPrediction).where(BracketPrediction.id.in_(bracket_ids))
            await db.execute(stmt_del_b)

        # 4. Wipe historical-ranking snapshots for any league bound to this tournament
        from models.league import League
        from models.historical_ranking import HistoricalRanking
        league_ids_res = await db.execute(
            select(League.id).where(League.tournament_id == tournament_id)
        )
        league_ids = league_ids_res.scalars().all()
        if league_ids:
            await db.execute(delete(HistoricalRanking).where(HistoricalRanking.league_id.in_(league_ids)))

        # 5. Delete Fixtures
        stmt_del_fixtures = delete(Fixture).where(Fixture.tournament_id == tournament_id)
        await db.execute(stmt_del_fixtures)

        await db.commit()

        # 6. Clear Redis grading guards and resync per-league leaderboards from rebuilt totals.
        await _clear_tournament_redis_guards(tournament_id)
        await _resync_leaderboards(db, affected_user_ids)

        # 7. Re-seed fixtures from the embedded catalog
        season = tournament.api_season or 2026
        scrape_res = await seed(tournament_id=tournament_id, season=season)

        # 8. Re-map football-data.org match IDs onto the freshly-created fixtures.
        #    Without this, data_source_match_id is NULL on all new rows and the
        #    poller cannot find fixtures to apply scores to.
        map_res = {"mapped": 0, "error": None}
        try:
            from services.football_data import map_fixture_ids
            mapped = await map_fixture_ids(tournament_id=tournament_id)
            map_res["mapped"] = mapped
        except RuntimeError as exc:
            # Key not configured — non-fatal; operator must run the seed script manually
            map_res["error"] = str(exc)
            logger.warning("Could not re-map football-data match IDs after reset: %s", exc)
        except Exception as exc:
            map_res["error"] = str(exc)
            logger.exception("Unexpected error re-mapping match IDs after reset: %s", exc)

        return {
            "status": "success",
            "message": "Tournament reset and re-seeded successfully.",
            "affected_users": len(affected_user_ids),
            "seeder_result": scrape_res,
            "api_id_mapping": map_res,
        }
    except Exception as exc:
        logger.exception("Reset and re-scrape failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Reset and re-scrape failed: {exc}")


# ---------------------------------------------------------------------------
# Targeted tournament resets
# ---------------------------------------------------------------------------

async def _deduct_and_delete_ledger(db: AsyncSession, tournament_id: int) -> list[int]:
    """Delete all ledger rows for a tournament, rebuild User.total_points from remaining ledger."""
    from models.user_points_ledger import UserPointsLedger
    from sqlalchemy import delete as sa_delete, func as sa_func

    # Find all users who have ledger rows for this tournament
    rows_res = await db.execute(
        select(UserPointsLedger.user_id).where(UserPointsLedger.tournament_id == tournament_id).distinct()
    )
    affected_user_ids = list(rows_res.scalars().all())

    # Delete the tournament's ledger rows
    await db.execute(
        sa_delete(UserPointsLedger).where(UserPointsLedger.tournament_id == tournament_id)
    )

    if not affected_user_ids:
        # Ledger may be empty but total_points could still be drifted — zero all users in the
        # tournament by finding anyone with predictions for it.
        from models.fixture import Fixture
        from models.match_prediction import MatchPrediction
        fixture_ids_res = await db.execute(
            select(Fixture.id).where(Fixture.tournament_id == tournament_id)
        )
        fixture_ids = fixture_ids_res.scalars().all()
        if fixture_ids:
            pred_user_res = await db.execute(
                select(MatchPrediction.user_id).where(MatchPrediction.fixture_id.in_(fixture_ids)).distinct()
            )
            affected_user_ids = list(pred_user_res.scalars().all())

    if not affected_user_ids:
        return []

    # Recompute each user's total from whatever ledger rows remain (other tournaments)
    remaining_res = await db.execute(
        select(UserPointsLedger.user_id, sa_func.coalesce(sa_func.sum(UserPointsLedger.points_awarded), 0))
        .where(UserPointsLedger.user_id.in_(affected_user_ids))
        .group_by(UserPointsLedger.user_id)
    )
    remaining_totals: dict[int, int] = {uid: int(pts) for uid, pts in remaining_res.all()}

    users_res = await db.execute(select(User).where(User.id.in_(affected_user_ids)))
    for user in users_res.scalars().all():
        user.total_points = remaining_totals.get(user.id, 0)

    return affected_user_ids


async def _resync_leaderboards(db: AsyncSession, user_ids: list[int]) -> None:
    if not user_ids:
        return
    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_by_id = {u.id: u for u in users_res.scalars().all()}
    memberships_res = await db.execute(
        select(LeagueMember).where(LeagueMember.user_id.in_(user_ids))
    )
    for m in memberships_res.scalars().all():
        user = users_by_id.get(m.user_id)
        if user:
            await update_user_score(m.league_id, user.id, user.total_points)


async def _clear_tournament_redis_guards(tournament_id: int) -> None:
    from models.fixture import FixtureStage
    for stage in FixtureStage:
        await redis_client.delete(f"grading:ko:{tournament_id}:{stage.value}:graded")
    groups = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for g in groups:
        await redis_client.delete(f"grading:group:{g}:graded")
    await redis_client.delete(f"cache:bracket:actual_results:{tournament_id}")


async def _restore_ko_placeholders(db: AsyncSession, tournament_id: int) -> int:
    """Re-apply seeder default placeholder team names + clear logos for all KO fixtures.

    Used after a results/all reset so KO progression written by simulation (e.g. concrete
    team names piped through _advance_ko_stage) is undone in lock-step with the score wipe.
    Matches fixtures by external_id against the seeder's pristine catalog.
    """
    from models.fixture import Fixture, FixtureStage
    from core.initial_seed import _generate_fallback_fixtures

    catalog_by_eid = {
        c["external_id"]: c
        for c in _generate_fallback_fixtures()
        if c["stage"] != FixtureStage.group
    }

    ko_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage != FixtureStage.group,
        )
    )
    updated = 0
    for f in ko_res.scalars().all():
        base = catalog_by_eid.get(f.external_id)
        if not base:
            continue
        f.home_team = base["home_team"]
        f.away_team = base["away_team"]
        f.home_logo = None
        f.away_logo = None
        updated += 1
    return updated


class PredictionResetScope(str, enum.Enum):
    pred_group_matches = "pred_group_matches"
    pred_group_standings = "pred_group_standings"
    pred_ko_bracket = "pred_ko_bracket"
    pred_r32_matches = "pred_r32_matches"
    pred_r16_matches = "pred_r16_matches"
    pred_qf_matches = "pred_qf_matches"
    pred_sf_matches = "pred_sf_matches"
    pred_finals_matches = "pred_finals_matches"


@router.get("/tournaments/{tournament_id}/reset/predictions/status", response_model=dict[str, str])
async def get_prediction_reset_status(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Determine the lock/open status of prediction stages for UI button colors.
    Returns a mapping of scope -> "open" | "not_yet_opened" | "closed".
    """
    from datetime import datetime, timezone
    from models.fixture import Fixture, FixtureStage
    from services.tournaments import resolve_bracket_lock_time

    # Helper helper
    def is_placeholder(name: str) -> bool:
        low = name.lower()
        return any(x in low for x in ["match", "placeholder", "winner", "loser", "runner", "group", "tbd"])

    # Fetch all fixtures for this tournament
    f_res = await db.execute(
        select(Fixture).where(Fixture.tournament_id == tournament_id)
    )
    all_fixtures = list(f_res.scalars().all())

    # Map stages to their fixtures
    fixtures_by_stage: dict[FixtureStage, list[Fixture]] = {}
    for f in all_fixtures:
        fixtures_by_stage.setdefault(f.stage, []).append(f)

    now_utc = datetime.now(timezone.utc)
    status_map: dict[str, str] = {}

    # 1. Group matches
    group_fixtures = fixtures_by_stage.get(FixtureStage.group, [])
    if not group_fixtures:
        status_map["pred_group_matches"] = "not_yet_opened"
    else:
        earliest_ko = min(f.kickoff_time for f in group_fixtures)
        if now_utc >= earliest_ko:
            status_map["pred_group_matches"] = "closed"
        else:
            status_map["pred_group_matches"] = "open"

    # 2. Group standings & 3. KO Bracket predictions
    # Both use resolve_bracket_lock_time
    bracket_lock = await resolve_bracket_lock_time(db, tournament_id)
    if not group_fixtures:
        status_map["pred_group_standings"] = "not_yet_opened"
        status_map["pred_ko_bracket"] = "not_yet_opened"
    else:
        if now_utc >= bracket_lock:
            status_map["pred_group_standings"] = "closed"
            status_map["pred_ko_bracket"] = "closed"
        else:
            status_map["pred_group_standings"] = "open"
            status_map["pred_ko_bracket"] = "open"

    # 4-7. KO stage matches helper
    def get_ko_stage_status(stage: FixtureStage) -> str:
        stage_fixtures = fixtures_by_stage.get(stage, [])
        if not stage_fixtures:
            return "not_yet_opened"
        has_placeholders = any(
            is_placeholder(f.home_team) or is_placeholder(f.away_team)
            for f in stage_fixtures
        )
        if has_placeholders:
            return "not_yet_opened"
        earliest_ko = min(f.kickoff_time for f in stage_fixtures)
        if now_utc >= earliest_ko:
            return "closed"
        return "open"

    status_map["pred_r32_matches"] = get_ko_stage_status(FixtureStage.round_32)
    status_map["pred_r16_matches"] = get_ko_stage_status(FixtureStage.round_16)
    status_map["pred_qf_matches"] = get_ko_stage_status(FixtureStage.quarter_final)
    status_map["pred_sf_matches"] = get_ko_stage_status(FixtureStage.semi_final)

    # 8. Finals matches (includes 3rd place and final)
    finals_fixtures = fixtures_by_stage.get(FixtureStage.final, []) + fixtures_by_stage.get(FixtureStage.third_place, [])
    if not finals_fixtures:
        status_map["pred_finals_matches"] = "not_yet_opened"
    else:
        has_placeholders = any(
            is_placeholder(f.home_team) or is_placeholder(f.away_team)
            for f in finals_fixtures
        )
        if has_placeholders:
            status_map["pred_finals_matches"] = "not_yet_opened"
        else:
            earliest_ko = min(f.kickoff_time for f in finals_fixtures)
            if now_utc >= earliest_ko:
                status_map["pred_finals_matches"] = "closed"
            else:
                status_map["pred_finals_matches"] = "open"

    return status_map


@router.post("/tournaments/{tournament_id}/reset/predictions/{scope}", response_model=dict)
async def reset_tournament_predictions_by_scope(
    tournament_id: int,
    scope: PredictionResetScope,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Granular prediction reset options to support pre-tournament resets."""
    from models.fixture import Fixture, FixtureStage
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from models.user_points_ledger import UserPointsLedger, PointsSourceType
    from sqlalchemy import delete as sa_delete
    from models.tournament import Tournament as Tourney
    from workers.points_recalc import recompute_users_in_session

    t_res = await db.execute(select(Tourney).where(Tourney.id == tournament_id))
    tournament = t_res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # Stamp the reset time so submit_bracket rejects auto-saves in the cooldown window.
    tournament.predictions_reset_at = datetime.now(timezone.utc)

    # We need to collect user_ids whose predictions are deleted so we can recalculate points if needed
    affected_user_ids: set[int] = set()

    # Determine fixtures and what bracket objects to delete
    if scope in (
        PredictionResetScope.pred_group_matches,
        PredictionResetScope.pred_r32_matches,
        PredictionResetScope.pred_r16_matches,
        PredictionResetScope.pred_qf_matches,
        PredictionResetScope.pred_sf_matches,
        PredictionResetScope.pred_finals_matches,
    ):
        stage_map = {
            PredictionResetScope.pred_group_matches: [FixtureStage.group],
            PredictionResetScope.pred_r32_matches: [FixtureStage.round_32],
            PredictionResetScope.pred_r16_matches: [FixtureStage.round_16],
            PredictionResetScope.pred_qf_matches: [FixtureStage.quarter_final],
            PredictionResetScope.pred_sf_matches: [FixtureStage.semi_final],
            PredictionResetScope.pred_finals_matches: [FixtureStage.third_place, FixtureStage.final],
        }
        stages = stage_map[scope]

        # Get all fixtures in the tournament for these stages
        fixtures_res = await db.execute(
            select(Fixture.id).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage.in_(stages),
            )
        )
        fixture_ids = list(fixtures_res.scalars().all())

        if fixture_ids:
            # Find affected users
            users_res = await db.execute(
                select(MatchPrediction.user_id)
                .where(MatchPrediction.fixture_id.in_(fixture_ids))
                .distinct()
            )
            affected_user_ids.update(users_res.scalars().all())

            # Delete predictions
            await db.execute(
                sa_delete(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids))
            )
            # Delete corresponding match points ledger rows if they exist
            await db.execute(
                sa_delete(UserPointsLedger).where(
                    UserPointsLedger.tournament_id == tournament_id,
                    UserPointsLedger.source_type == PointsSourceType.match,
                    UserPointsLedger.source_id.in_([str(fid) for fid in fixture_ids])
                )
            )

    elif scope == PredictionResetScope.pred_group_standings:
        # Get bracket predictions for this tournament
        bracket_ids_res = await db.execute(
            select(BracketPrediction.id, BracketPrediction.user_id)
            .where(BracketPrediction.tournament_id == tournament_id)
        )
        bracket_rows = bracket_ids_res.all()
        bracket_ids = [row[0] for row in bracket_rows]
        affected_user_ids.update(row[1] for row in bracket_rows)

        if bracket_ids:
            await db.execute(
                sa_delete(BracketGroupPick).where(BracketGroupPick.bracket_id.in_(bracket_ids))
            )
            await db.execute(
                sa_delete(UserPointsLedger).where(
                    UserPointsLedger.tournament_id == tournament_id,
                    UserPointsLedger.source_type == PointsSourceType.group_bracket,
                )
            )

    elif scope == PredictionResetScope.pred_ko_bracket:
        bracket_ids_res = await db.execute(
            select(BracketPrediction.id, BracketPrediction.user_id)
            .where(BracketPrediction.tournament_id == tournament_id)
        )
        bracket_rows = bracket_ids_res.all()
        bracket_ids = [row[0] for row in bracket_rows]
        affected_user_ids.update(row[1] for row in bracket_rows)

        if bracket_ids:
            await db.execute(
                sa_delete(BracketKoPick).where(BracketKoPick.bracket_id.in_(bracket_ids))
            )
            await db.execute(
                sa_delete(UserPointsLedger).where(
                    UserPointsLedger.tournament_id == tournament_id,
                    UserPointsLedger.source_type == PointsSourceType.ko_bracket,
                )
            )

    # Flush changes so points_recalc recomputes from post-delete state
    await db.flush()

    if affected_user_ids:
        # Recalculate totals and bracket points
        await recompute_users_in_session(db, list(affected_user_ids), tournament_id=tournament_id)
        await db.commit()
        await _resync_leaderboards(db, list(affected_user_ids))
    else:
        await db.commit()

    return {"status": "ok", "affected_users": len(affected_user_ids)}


@router.post("/tournaments/{tournament_id}/reset/predictions", response_model=dict)
async def reset_tournament_predictions(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Delete all match predictions and bracket predictions for this tournament."""
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from sqlalchemy import delete as sa_delete

    from models.tournament import Tournament as Tourney
    t_res = await db.execute(select(Tourney).where(Tourney.id == tournament_id))
    tournament = t_res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # Stamp the reset time so submit_bracket rejects auto-saves in the cooldown window.
    tournament.predictions_reset_at = datetime.now(timezone.utc)

    affected_user_ids = await _deduct_and_delete_ledger(db, tournament_id)

    fixture_ids_res = await db.execute(
        select(Fixture.id).where(Fixture.tournament_id == tournament_id)
    )
    fixture_ids = fixture_ids_res.scalars().all()
    if fixture_ids:
        await db.execute(sa_delete(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids)))

    bracket_ids_res = await db.execute(
        select(BracketPrediction.id).where(BracketPrediction.tournament_id == tournament_id)
    )
    bracket_ids = bracket_ids_res.scalars().all()
    if bracket_ids:
        await db.execute(sa_delete(BracketGroupPick).where(BracketGroupPick.bracket_id.in_(bracket_ids)))
        await db.execute(sa_delete(BracketKoPick).where(BracketKoPick.bracket_id.in_(bracket_ids)))
        await db.execute(sa_delete(BracketPrediction).where(BracketPrediction.id.in_(bracket_ids)))

    await db.commit()
    await _resync_leaderboards(db, affected_user_ids)
    return {"status": "ok", "affected_users": len(affected_user_ids)}


@router.post("/tournaments/{tournament_id}/reset/results", response_model=dict)
async def reset_tournament_results(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Blank all fixture scores → scheduled; zero prediction points; wipe ledger."""
    from models.fixture import Fixture, FixtureStatus
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.tournament import Tournament as Tourney
    from models.league import League
    from models.historical_ranking import HistoricalRanking
    from sqlalchemy import delete as sa_delete

    t_res = await db.execute(select(Tourney).where(Tourney.id == tournament_id))
    if not t_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Tournament not found")

    affected_user_ids = await _deduct_and_delete_ledger(db, tournament_id)

    fixtures_res = await db.execute(
        select(Fixture).where(Fixture.tournament_id == tournament_id)
    )
    fixture_ids = []
    for f in fixtures_res.scalars().all():
        f.home_score = None
        f.away_score = None
        f.home_score_aet = None
        f.away_score_aet = None
        f.knockout_winner = None
        f.status = FixtureStatus.scheduled
        fixture_ids.append(f.id)

    if fixture_ids:
        preds_res = await db.execute(
            select(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids))
        )
        for pred in preds_res.scalars().all():
            pred.points_awarded = 0
            pred.is_locked = False

    brackets_res = await db.execute(
        select(BracketPrediction).where(BracketPrediction.tournament_id == tournament_id)
    )
    for bracket in brackets_res.scalars().all():
        bracket.total_points = 0

    league_ids_res = await db.execute(
        select(League.id).where(League.tournament_id == tournament_id)
    )
    league_ids = league_ids_res.scalars().all()
    if league_ids:
        await db.execute(sa_delete(HistoricalRanking).where(HistoricalRanking.league_id.in_(league_ids)))

    await _restore_ko_placeholders(db, tournament_id)

    await db.commit()
    await _clear_tournament_redis_guards(tournament_id)
    await _resync_leaderboards(db, affected_user_ids)
    return {"status": "ok", "fixtures_reset": len(fixture_ids), "affected_users": len(affected_user_ids)}


@router.post("/tournaments/{tournament_id}/snapshot-history", response_model=dict)
async def retake_history_snapshot(
    tournament_id: int,
    matchday_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Re-take a HistoricalRanking snapshot from current Redis leaderboard state.

    Use after group standings grading to correct a stale MD-3 snapshot.
    ``matchday_id`` should match the label used by the chart (e.g. ``MD-3``).
    """
    from models.league import League
    from services.leaderboard import snapshot_league_ranks

    league_ids_res = await db.execute(
        select(League.id).where(League.tournament_id == tournament_id)
    )
    league_ids = set(league_ids_res.scalars().all())
    if not league_ids:
        raise HTTPException(status_code=404, detail="No leagues found for this tournament")
    written = await snapshot_league_ranks(db, league_ids, matchday_id)
    return {"status": "ok", "rows_written": written}


@router.post("/tournaments/{tournament_id}/reset/points", response_model=dict)
async def reset_tournament_points(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Zero all awarded points for this tournament; keep predictions and results intact."""
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.tournament import Tournament as Tourney
    from models.league import League
    from models.historical_ranking import HistoricalRanking
    from sqlalchemy import delete as sa_delete

    t_res = await db.execute(select(Tourney).where(Tourney.id == tournament_id))
    if not t_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Tournament not found")

    affected_user_ids = await _deduct_and_delete_ledger(db, tournament_id)

    fixture_ids_res = await db.execute(
        select(Fixture.id).where(Fixture.tournament_id == tournament_id)
    )
    fixture_ids = fixture_ids_res.scalars().all()
    if fixture_ids:
        preds_res = await db.execute(
            select(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids))
        )
        for pred in preds_res.scalars().all():
            pred.points_awarded = 0

    brackets_res = await db.execute(
        select(BracketPrediction).where(BracketPrediction.tournament_id == tournament_id)
    )
    for bracket in brackets_res.scalars().all():
        bracket.total_points = 0

    from models.league import League
    from models.historical_ranking import HistoricalRanking
    league_ids_res = await db.execute(
        select(League.id).where(League.tournament_id == tournament_id)
    )
    league_ids = league_ids_res.scalars().all()
    if league_ids:
        await db.execute(sa_delete(HistoricalRanking).where(HistoricalRanking.league_id.in_(league_ids)))

    await db.commit()
    await _clear_tournament_redis_guards(tournament_id)
    await _resync_leaderboards(db, affected_user_ids)
    return {"status": "ok", "affected_users": len(affected_user_ids)}


@router.post("/tournaments/{tournament_id}/reset/all", response_model=dict)
async def reset_tournament_all(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Reset results, predictions, and points for this tournament."""
    from models.fixture import Fixture, FixtureStatus
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from models.tournament import Tournament as Tourney
    from models.league import League
    from models.historical_ranking import HistoricalRanking
    from sqlalchemy import delete as sa_delete

    t_res = await db.execute(select(Tourney).where(Tourney.id == tournament_id))
    tournament = t_res.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    # Stamp the reset time so submit_bracket rejects auto-saves in the cooldown window.
    tournament.predictions_reset_at = datetime.now(timezone.utc)

    affected_user_ids = await _deduct_and_delete_ledger(db, tournament_id)

    fixtures_res = await db.execute(
        select(Fixture).where(Fixture.tournament_id == tournament_id)
    )
    fixture_ids = []
    for f in fixtures_res.scalars().all():
        f.home_score = None
        f.away_score = None
        f.home_score_aet = None
        f.away_score_aet = None
        f.knockout_winner = None
        f.status = FixtureStatus.scheduled
        fixture_ids.append(f.id)

    if fixture_ids:
        await db.execute(sa_delete(MatchPrediction).where(MatchPrediction.fixture_id.in_(fixture_ids)))

    bracket_ids_res = await db.execute(
        select(BracketPrediction.id).where(BracketPrediction.tournament_id == tournament_id)
    )
    bracket_ids = bracket_ids_res.scalars().all()
    if bracket_ids:
        await db.execute(sa_delete(BracketGroupPick).where(BracketGroupPick.bracket_id.in_(bracket_ids)))
        await db.execute(sa_delete(BracketKoPick).where(BracketKoPick.bracket_id.in_(bracket_ids)))
        await db.execute(sa_delete(BracketPrediction).where(BracketPrediction.id.in_(bracket_ids)))

    league_ids_res = await db.execute(
        select(League.id).where(League.tournament_id == tournament_id)
    )
    league_ids = league_ids_res.scalars().all()
    if league_ids:
        await db.execute(sa_delete(HistoricalRanking).where(HistoricalRanking.league_id.in_(league_ids)))

    await _restore_ko_placeholders(db, tournament_id)

    await db.commit()
    await _clear_tournament_redis_guards(tournament_id)
    await _resync_leaderboards(db, affected_user_ids)
    return {"status": "ok", "fixtures_reset": len(fixture_ids), "affected_users": len(affected_user_ids)}


# ---------------------------------------------------------------------------
# GET /admin/build-info
# ---------------------------------------------------------------------------

_PROCESS_START = time.time()


class CeleryTaskInfo(BaseModel):
    name: str
    schedule: str
    last_run_at: str | None
    next_run_at: str | None


class GradingOrphan(BaseModel):
    fixture_id: int
    fixture_label: str
    ungraded_predictions: int


class ScraperStats(BaseModel):
    inserted: int
    updated: int
    skipped: int
    total: int
    wiki_fixtures_scraped: int
    score_updates: int
    merged: int


class BuildInfo(BaseModel):
    git_commit: str | None
    build_number: str | None
    build_date: str | None
    uptime_seconds: float
    # DB counts
    user_count: int
    active_user_count: int
    league_count: int
    tournament_count: int
    fixture_count: int
    completed_fixture_count: int
    prediction_count: int
    # Celery / Redis
    redis_connected: bool
    redis_memory_used_mb: float | None
    celery_last_heartbeat: str | None
    celery_tasks: list[CeleryTaskInfo]
    # Fixture sync
    last_fixture_sync: str | None
    last_live_poll: str | None
    # Grading health
    grading_orphans: list[GradingOrphan]
    # Email
    last_digest_sent: str | None
    digest_recipients_last_run: int | None
    # Wikipedia scraper
    scraper_last_run_at: str | None
    scraper_last_outcome: str | None  # "success" | "fallback_only" | "error"
    scraper_last_stats: ScraperStats | None
    scraper_last_error: str | None


@router.get("/build-info", response_model=BuildInfo)
async def get_build_info(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Return system build metadata, DB statistics, Celery health, and grading pipeline status."""
    from models.league import League
    from models.tournament import Tournament
    from models.fixture import Fixture, FixtureStatus
    from models.match_prediction import MatchPrediction
    from models.email_log import EmailLog

    # --- Git info (injected at build time as env vars) ---
    git_commit = os.environ.get("GIT_COMMIT") or os.environ.get("COMMIT_SHA")
    build_date = os.environ.get("BUILD_DATE") or os.environ.get("BUILD_TIMESTAMP")
    build_number = os.environ.get("BUILD_NUMBER") or None

    # --- DB counts ---
    user_count = (await db.execute(select(sa_func.count(User.id)))).scalar() or 0
    active_user_count = (
        await db.execute(select(sa_func.count(User.id)).where(User.is_active == True))  # noqa: E712
    ).scalar() or 0
    league_count = (await db.execute(select(sa_func.count(League.id)))).scalar() or 0
    tournament_count = (await db.execute(select(sa_func.count(Tournament.id)))).scalar() or 0
    fixture_count = (await db.execute(select(sa_func.count(Fixture.id)))).scalar() or 0
    completed_fixture_count = (
        await db.execute(
            select(sa_func.count(Fixture.id)).where(Fixture.status == FixtureStatus.completed)
        )
    ).scalar() or 0
    prediction_count = (await db.execute(select(sa_func.count(MatchPrediction.id)))).scalar() or 0

    # --- Redis ---
    redis_connected = False
    redis_memory_mb: float | None = None
    last_fixture_sync: str | None = None
    last_live_poll: str | None = None
    celery_last_heartbeat: str | None = None
    last_digest_sent_redis: str | None = None
    digest_recipients: int | None = None
    scraper_last_run_at: str | None = None
    scraper_last_outcome: str | None = None
    scraper_stats_raw: str | None = None
    scraper_last_error: str | None = None

    try:
        await redis_client.ping()
        redis_connected = True

        info = await redis_client.info("memory")
        used_bytes = info.get("used_memory", 0)
        redis_memory_mb = round(used_bytes / (1024 * 1024), 2)

        last_fixture_sync = await redis_client.get("admin:last_fixture_sync")
        last_live_poll = await redis_client.get("admin:last_live_poll")
        celery_hb = await redis_client.get("celery:worker:last_heartbeat")
        celery_last_heartbeat = celery_hb
        last_digest_sent_redis = await redis_client.get("digest:last_sent")
        dr = await redis_client.get("digest:last_recipients")
        digest_recipients = int(dr) if dr else None

        scraper_last_run_at = await redis_client.get("scraper:last_run_at")
        scraper_last_outcome = await redis_client.get("scraper:last_outcome")
        scraper_stats_raw = await redis_client.get("scraper:last_stats")
        scraper_last_error = await redis_client.get("scraper:last_error")
    except Exception:
        pass

    # --- Celery beat schedule (static, from config) ---
    from core.celery_app import celery_app
    celery_tasks: list[CeleryTaskInfo] = []
    for name, entry in celery_app.conf.beat_schedule.items():
        sched = entry.get("schedule")
        sched_str = str(sched) if sched is not None else "unknown"
        celery_tasks.append(CeleryTaskInfo(
            name=name,
            schedule=sched_str,
            last_run_at=None,
            next_run_at=None,
        ))

    # --- Grading orphans: completed fixtures with ungraded predictions ---
    orphan_rows = await db.execute(
        select(
            Fixture.id,
            Fixture.home_team,
            Fixture.away_team,
            sa_func.count(MatchPrediction.id).label("ungraded"),
        )
        .join(MatchPrediction, MatchPrediction.fixture_id == Fixture.id)
        .where(
            Fixture.status == FixtureStatus.completed,
            MatchPrediction.points_awarded == 0,
        )
        .group_by(Fixture.id, Fixture.home_team, Fixture.away_team)
        .having(sa_func.count(MatchPrediction.id) > 0)
    )
    grading_orphans = [
        GradingOrphan(
            fixture_id=row.id,
            fixture_label=f"{row.home_team} vs {row.away_team}",
            ungraded_predictions=row.ungraded,
        )
        for row in orphan_rows.all()
    ]

    # --- Last digest from email_log table ---
    last_digest_db: str | None = None
    try:
        from models.email_template import EmailType
        digest_res = await db.execute(
            select(EmailLog.sent_at)
            .where(EmailLog.email_type == EmailType.daily_digest)
            .order_by(EmailLog.sent_at.desc())
            .limit(1)
        )
        row = digest_res.scalar_one_or_none()
        if row:
            last_digest_db = row.isoformat()
    except Exception:
        pass

    import json as _json
    scraper_stats: ScraperStats | None = None
    if scraper_stats_raw:
        try:
            raw = _json.loads(scraper_stats_raw)
            scraper_stats = ScraperStats(**raw)
        except Exception:
            pass

    return BuildInfo(
        git_commit=git_commit,
        build_number=build_number if build_number and build_number != "0" else None,
        build_date=build_date,
        uptime_seconds=round(time.time() - _PROCESS_START, 1),
        user_count=user_count,
        active_user_count=active_user_count,
        league_count=league_count,
        tournament_count=tournament_count,
        fixture_count=fixture_count,
        completed_fixture_count=completed_fixture_count,
        prediction_count=prediction_count,
        redis_connected=redis_connected,
        redis_memory_used_mb=redis_memory_mb,
        celery_last_heartbeat=celery_last_heartbeat,
        celery_tasks=celery_tasks,
        last_fixture_sync=last_fixture_sync,
        last_live_poll=last_live_poll,
        grading_orphans=grading_orphans,
        last_digest_sent=last_digest_sent_redis or last_digest_db,
        digest_recipients_last_run=digest_recipients,
        scraper_last_run_at=scraper_last_run_at,
        scraper_last_outcome=scraper_last_outcome,
        scraper_last_stats=scraper_stats,
        scraper_last_error=scraper_last_error,
    )


@router.get("/test-sync")
async def test_sync(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_admin)):
    """Diagnostic endpoint to execute seeder and capture exact tracebacks.

    Gated behind DEBUG so the seeder traceback (which can leak DB URL fragments
    and other secrets) is never reachable in production builds.
    """
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail="Not Found")

    import traceback
    try:
        from services.football_data import fetch_and_apply_results
        newly_completed = await fetch_and_apply_results(tournament_id=1)
        return {"status": "success", "newly_completed": newly_completed}
    except Exception as e:
        tb = traceback.format_exc()
        return {"status": "error", "message": str(e), "traceback": tb}


# ---------------------------------------------------------------------------
# Database Backups & Prediction Export/Import Endpoints
# ---------------------------------------------------------------------------

from pydantic import Field

class BackupSettingsUpdate(BaseModel):
    enabled: bool
    time: str = Field("03:00")
    retention_days: int = Field(7, ge=1, le=365)

class BackupFileOut(BaseModel):
    filename: str
    created_at: str
    size_bytes: int

@router.get("/backups", response_model=list[BackupFileOut])
async def get_backups(
    _: User = Depends(get_current_admin)
):
    """List all database backup files in the backup directory."""
    from services.backup_service import list_backups
    try:
        return list_backups()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backups", status_code=201)
async def trigger_backup(
    _: User = Depends(get_current_admin)
):
    """Trigger a manual database backup."""
    from services.backup_service import create_db_backup
    try:
        res = create_db_backup()
        return {
            "message": "Backup created successfully",
            "filename": res["filename"],
            "size_bytes": res["size_bytes"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/backups/{filename}", status_code=204)
async def remove_backup(
    filename: str,
    _: User = Depends(get_current_admin)
):
    """Delete a database backup file."""
    from services.backup_service import delete_backup
    try:
        delete_backup(filename)
        return
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backups/{filename}/restore")
async def restore_backup(
    filename: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Destructively restore database from a backup file."""
    from services.backup_service import restore_db_backup
    try:
        output = await restore_db_backup(filename, db)
        return {"message": "Database restored successfully", "output": output}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/backups/settings")
async def get_backup_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Get automated backup scheduler settings."""
    from models.setting import Setting
    res = await db.execute(select(Setting).where(Setting.key.in_(["backup_enabled", "backup_time", "backup_retention_days"])))
    items = {item.key: item.value for item in res.scalars().all()}
    
    return {
        "enabled": items.get("backup_enabled") == "true",
        "time": items.get("backup_time", "03:00"),
        "retention_days": int(items.get("backup_retention_days", "7"))
    }

@router.put("/backups/settings")
async def update_backup_settings(
    payload: BackupSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Update automated backup scheduler settings."""
    from models.setting import Setting
    
    keys_values = {
        "backup_enabled": "true" if payload.enabled else "false",
        "backup_time": payload.time,
        "backup_retention_days": str(payload.retention_days)
    }
    
    for key, val in keys_values.items():
        res = await db.execute(select(Setting).where(Setting.key == key))
        setting = res.scalar_one_or_none()
        if not setting:
            setting = Setting(key=key, value=val)
            db.add(setting)
        else:
            setting.value = val
            
    await db.commit()
    return {"message": "Backup settings updated successfully"}

@router.get("/tournaments/{tournament_id}/export-predictions")
async def export_predictions(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Export all user match predictions and bracket picks for a given tournament as JSON."""
    from models.tournament import Tournament
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick
    from models.user import User as DBUser
    
    res_t = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res_t.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
        
    # Get all fixtures
    res_f = await db.execute(select(Fixture).where(Fixture.tournament_id == tournament_id))
    fixtures = res_f.scalars().all()
    fixture_map = {f.id: f.external_id or f"id-{f.id}" for f in fixtures}
    fixture_ids = list(fixture_map.keys())
    
    # Get match predictions
    match_preds = []
    if fixture_ids:
        res_mp = await db.execute(
            select(MatchPrediction, DBUser)
            .join(DBUser, MatchPrediction.user_id == DBUser.id)
            .where(MatchPrediction.fixture_id.in_(fixture_ids))
        )
        for mp, user in res_mp.all():
            match_preds.append({
                "user_email": user.email,
                "fixture_external_id": fixture_map[mp.fixture_id],
                "predicted_home": mp.predicted_home,
                "predicted_away": mp.predicted_away,
                "points_awarded": mp.points_awarded,
                "is_locked": mp.is_locked,
                "submitted_at": mp.submitted_at.isoformat() if mp.submitted_at else None
            })
            
    # Get bracket predictions
    bracket_preds = []
    res_bp = await db.execute(
        select(BracketPrediction, DBUser)
        .join(DBUser, BracketPrediction.user_id == DBUser.id)
        .where(BracketPrediction.tournament_id == tournament_id)
    )
    for bp, user in res_bp.all():
        # Load group picks
        res_gp = await db.execute(select(BracketGroupPick).where(BracketGroupPick.bracket_id == bp.id))
        group_picks = [{
            "group_code": gp.group_code,
            "position": gp.position,
            "predicted_team": gp.predicted_team
        } for gp in res_gp.scalars().all()]
        
        # Load KO picks
        res_kp = await db.execute(select(BracketKoPick).where(BracketKoPick.bracket_id == bp.id))
        ko_picks = [{
            "round": kp.round.value,
            "slot": kp.slot,
            "predicted_team": kp.predicted_team
        } for kp in res_kp.scalars().all()]
        
        bracket_preds.append({
            "user_email": user.email,
            "is_locked": bp.is_locked,
            "total_points": bp.total_points,
            "submitted_at": bp.submitted_at.isoformat() if bp.submitted_at else None,
            "group_picks": group_picks,
            "ko_picks": ko_picks
        })
        
    return {
        "tournament_id": tournament.id,
        "tournament_name": tournament.name,
        "match_predictions": match_preds,
        "bracket_predictions": bracket_preds
    }

@router.post("/tournaments/{tournament_id}/import-predictions")
async def import_predictions(
    tournament_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Import match predictions and bracket picks for a given tournament from JSON."""
    from models.tournament import Tournament
    from models.fixture import Fixture
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick, KoRound
    from models.user import User as DBUser
    from sqlalchemy import delete
    
    res_t = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = res_t.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
        
    # Load users
    res_u = await db.execute(select(DBUser))
    user_map = {u.email.lower(): u for u in res_u.scalars().all()}
    
    # Load fixtures
    res_f = await db.execute(select(Fixture).where(Fixture.tournament_id == tournament_id))
    fixtures = res_f.scalars().all()
    fixture_map = {f.external_id: f for f in fixtures if f.external_id}
    # Also support falling back to ID if external_id was missing
    for f in fixtures:
        fixture_map[f"id-{f.id}"] = f
        
    stats = {
        "match_predictions_imported": 0,
        "bracket_predictions_imported": 0,
        "skipped_users": [],
        "skipped_fixtures": []
    }
    
    # Import match predictions
    match_preds_data = payload.get("match_predictions", [])
    for mp_data in match_preds_data:
        email = mp_data.get("user_email", "").lower()
        fixture_eid = mp_data.get("fixture_external_id")
        
        user = user_map.get(email)
        if not user:
            if email not in stats["skipped_users"]:
                stats["skipped_users"].append(email)
            continue
            
        fixture = fixture_map.get(fixture_eid)
        if not fixture:
            if fixture_eid not in stats["skipped_fixtures"]:
                stats["skipped_fixtures"].append(fixture_eid)
            continue
            
        # Check if already exists
        res_mp = await db.execute(
            select(MatchPrediction)
            .where(MatchPrediction.user_id == user.id, MatchPrediction.fixture_id == fixture.id)
        )
        mp = res_mp.scalar_one_or_none()
        if not mp:
            mp = MatchPrediction(
                user_id=user.id,
                fixture_id=fixture.id,
                predicted_home=mp_data["predicted_home"],
                predicted_away=mp_data["predicted_away"],
                points_awarded=mp_data.get("points_awarded", 0),
                is_locked=mp_data.get("is_locked", False)
            )
            db.add(mp)
        else:
            mp.predicted_home = mp_data["predicted_home"]
            mp.predicted_away = mp_data["predicted_away"]
            mp.points_awarded = mp_data.get("points_awarded", 0)
            mp.is_locked = mp_data.get("is_locked", False)
            
        stats["match_predictions_imported"] += 1
        
    # Import bracket predictions
    bracket_preds_data = payload.get("bracket_predictions", [])
    for bp_data in bracket_preds_data:
        email = bp_data.get("user_email", "").lower()
        user = user_map.get(email)
        if not user:
            if email not in stats["skipped_users"]:
                stats["skipped_users"].append(email)
            continue
            
        # Check if bracket container exists
        res_bp = await db.execute(
            select(BracketPrediction)
            .where(BracketPrediction.user_id == user.id, BracketPrediction.tournament_id == tournament_id)
        )
        bp = res_bp.scalar_one_or_none()
        if not bp:
            bp = BracketPrediction(
                user_id=user.id,
                tournament_id=tournament_id,
                is_locked=bp_data.get("is_locked", False),
                total_points=bp_data.get("total_points", 0)
            )
            db.add(bp)
            await db.flush() # get the id
        else:
            bp.is_locked = bp_data.get("is_locked", False)
            bp.total_points = bp_data.get("total_points", 0)
            
        # Wipe existing group & KO picks for this bracket to avoid conflicts
        await db.execute(delete(BracketGroupPick).where(BracketGroupPick.bracket_id == bp.id))
        await db.execute(delete(BracketKoPick).where(BracketKoPick.bracket_id == bp.id))
        
        # Add new group picks
        for gp_data in bp_data.get("group_picks", []):
            gp = BracketGroupPick(
                bracket_id=bp.id,
                group_code=gp_data["group_code"],
                position=gp_data["position"],
                predicted_team=gp_data["predicted_team"]
            )
            db.add(gp)
            
        # Add new KO picks
        for kp_data in bp_data.get("ko_picks", []):
            try:
                ko_rnd = KoRound(kp_data["round"])
                kp = BracketKoPick(
                    bracket_id=bp.id,
                    round=ko_rnd,
                    slot=kp_data["slot"],
                    predicted_team=kp_data["predicted_team"]
                )
                db.add(kp)
            except Exception:
                # skip invalid round names or validation issues
                pass
                
        stats["bracket_predictions_imported"] += 1
        
    await db.commit()
    return {
        "message": "Predictions imported successfully",
        "stats": stats
    }
