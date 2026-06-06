from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from api.deps import get_current_user, get_current_admin, get_db
from models.user import User
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from models.user_email_preference import UserEmailPreference
from models.email_template import EmailType
from models.tournament import Tournament
from models.tournament_email_settings import TournamentEmailSettings
from models.fixture import Fixture
from schemas.user import (
    UserResponse,
    UserPermissionsUpdate,
    PointsHistoryEntry,
    PointsHistoryResponse,
    PointsHistoryTournamentSummary,
)
from services.csv_provisioner import provision_users_from_csv

router = APIRouter()


_STAGE_LABELS = {
    "round_32": "Round of 32",
    "round_16": "Round of 16",
    "quarter_final": "Quarter-Final",
    "semi_final": "Semi-Final",
    "third_place": "3rd Place Playoff",
    "final": "Final",
    "finals": "Finals Weekend",
}

_MATCH_REASON = {5: "Exact score", 3: "Correct margin", 2: "Correct outcome"}

_KO_SLOT_COUNTS = {
    "round_32": 32,
    "round_16": 16,
    "quarter_final": 8,
    "semi_final": 4,
    "third_place": 2,
    "final": 2,
    "finals": 4,
}

_KO_POINTS_PER_TEAM = 5


def _match_number(external_id: str | None) -> str | None:
    """Parse 'wc2026-m42' → 'M42'."""
    if not external_id:
        return None
    import re
    m = re.search(r"m(\d+)$", external_id, re.IGNORECASE)
    return f"M{m.group(1)}" if m else None


def _label_for_ledger_row(
    source_type: PointsSourceType,
    source_id: str,
    fixture_lookup: dict[int, Fixture],
) -> str:
    """Render a human-friendly description for a ledger row's source."""
    if source_type == PointsSourceType.match:
        try:
            fixture_id = int(source_id)
        except ValueError:
            return f"Match #{source_id}"
        fixture = fixture_lookup.get(fixture_id)
        if not fixture:
            return f"Match #{fixture_id}"
        score = ""
        if fixture.home_score is not None and fixture.away_score is not None:
            score = f" {fixture.home_score}–{fixture.away_score}"
        return f"{fixture.home_team or '?'}{score} {fixture.away_team or '?'}".strip()

    if source_type == PointsSourceType.group_bracket:
        return f"Group {source_id} final standings"

    if source_type == PointsSourceType.ko_bracket:
        # source_id is "{stage}:{tournament_id}" e.g. "round_32:1" or "finals:1"
        stage = source_id.split(":", 1)[0] if ":" in source_id else source_id
        return _STAGE_LABELS.get(stage, stage.replace("_", " ").title())


def _extra_fields_for_ledger_row(
    source_type: PointsSourceType,
    source_id: str,
    points_awarded: int,
    fixture_lookup: dict[int, Fixture],
) -> tuple[str | None, str | None, str | None]:
    """Return (match_number, context, reason) for a ledger row."""
    if source_type == PointsSourceType.match:
        try:
            fixture_id = int(source_id)
        except ValueError:
            return None, None, None
        fixture = fixture_lookup.get(fixture_id)
        if not fixture:
            return None, None, None
        num = _match_number(fixture.external_id)
        if fixture.group_code:
            ctx = f"Group {fixture.group_code}" + (f" · MD{fixture.matchday}" if fixture.matchday else "")
        else:
            stage_str = fixture.stage.value if hasattr(fixture.stage, "value") else str(fixture.stage)
            ctx = _STAGE_LABELS.get(stage_str, stage_str.replace("_", " ").title())
        reason = _MATCH_REASON.get(points_awarded)
        return num, ctx, reason

    if source_type == PointsSourceType.group_bracket:
        return None, f"Group {source_id}", None

    if source_type == PointsSourceType.ko_bracket:
        stage = source_id.split(":", 1)[0] if ":" in source_id else source_id
        stage_label = _STAGE_LABELS.get(stage, stage.replace("_", " ").title())
        total_slots = _KO_SLOT_COUNTS.get(stage)
        if total_slots and points_awarded > 0:
            teams_correct = points_awarded // _KO_POINTS_PER_TEAM
            reason = f"{teams_correct}/{total_slots} teams predicted"
        else:
            reason = None
        return None, stage_label, reason

    return None, None, None

    return source_id

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/me/points-history", response_model=PointsHistoryResponse)
async def read_my_points_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the authenticated user's full points ledger with per-tournament
    summaries and human-friendly source labels."""
    ledger_res = await db.execute(
        select(UserPointsLedger)
        .where(UserPointsLedger.user_id == current_user.id)
        .order_by(UserPointsLedger.created_at.desc())
    )
    rows = list(ledger_res.scalars().all())

    if not rows:
        return PointsHistoryResponse(summaries=[], entries=[])

    tournament_ids = {r.tournament_id for r in rows}
    tourn_res = await db.execute(
        select(Tournament).where(Tournament.id.in_(tournament_ids))
    )
    tournaments_by_id = {t.id: t for t in tourn_res.scalars().all()}

    # Bulk-fetch fixtures referenced by match-source rows
    fixture_ids: set[int] = set()
    for r in rows:
        if r.source_type == PointsSourceType.match:
            try:
                fixture_ids.add(int(r.source_id))
            except ValueError:
                continue
    fixture_lookup: dict[int, Fixture] = {}
    if fixture_ids:
        fix_res = await db.execute(select(Fixture).where(Fixture.id.in_(fixture_ids)))
        fixture_lookup = {f.id: f for f in fix_res.scalars().all()}

    entries = []
    for r in rows:
        match_number, context, reason = _extra_fields_for_ledger_row(
            r.source_type, r.source_id, r.points_awarded, fixture_lookup
        )
        entries.append(PointsHistoryEntry(
            id=r.id,
            tournament_id=r.tournament_id,
            tournament_name=(tournaments_by_id.get(r.tournament_id).name if tournaments_by_id.get(r.tournament_id) else f"Tournament {r.tournament_id}"),
            points_awarded=r.points_awarded,
            source_type=r.source_type.value,
            source_id=r.source_id,
            source_label=_label_for_ledger_row(r.source_type, r.source_id, fixture_lookup),
            match_number=match_number,
            context=context,
            reason=reason,
            created_at=r.created_at,
        ))

    summaries_by_tid: dict[int, PointsHistoryTournamentSummary] = {}
    for r in rows:
        tname = tournaments_by_id.get(r.tournament_id).name if tournaments_by_id.get(r.tournament_id) else f"Tournament {r.tournament_id}"
        s = summaries_by_tid.setdefault(
            r.tournament_id,
            PointsHistoryTournamentSummary(
                tournament_id=r.tournament_id,
                tournament_name=tname,
                total_points=0,
                match_points=0,
                group_bracket_points=0,
                ko_bracket_points=0,
            ),
        )
        s.total_points += r.points_awarded
        if r.source_type == PointsSourceType.match:
            s.match_points += r.points_awarded
        elif r.source_type == PointsSourceType.group_bracket:
            s.group_bracket_points += r.points_awarded
        elif r.source_type == PointsSourceType.ko_bracket:
            s.ko_bracket_points += r.points_awarded

    return PointsHistoryResponse(
        summaries=sorted(summaries_by_tid.values(), key=lambda s: -s.total_points),
        entries=entries,
    )

@router.post("/bulk-provision", dependencies=[Depends(get_current_admin)])
async def bulk_provision(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    content = await file.read()
    results = await provision_users_from_csv(db, content.decode("utf-8"))
    return {"message": f"Provisioned {len(results)} users", "results": results}

@router.put("/{user_id}/permissions", response_model=UserResponse, dependencies=[Depends(get_current_admin)])
async def update_user_permissions(user_id: int, permissions_in: UserPermissionsUpdate, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.can_manage_leagues = permissions_in.can_manage_leagues
    user.can_invite_users = permissions_in.can_invite_users
    await db.commit()
    await db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Profile Editing Endpoint
# ---------------------------------------------------------------------------
from pydantic import BaseModel, EmailStr
from typing import Optional
from core.security import get_password_hash, verify_password

class ProfileUpdate(BaseModel):
    display_name: str
    team_name: str
    email: EmailStr
    current_password: Optional[str] = None
    new_password: Optional[str] = None

@router.get("/me/email-preferences", response_model=list[dict])
async def get_email_preferences(
    tournament_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(
        select(UserEmailPreference).where(UserEmailPreference.user_id == current_user.id)
    )
    rows = {r.email_type: r.opted_in for r in res.scalars().all()}

    tournament_enabled: dict[EmailType, bool] = {}
    if tournament_id is not None:
        t_res = await db.execute(
            select(TournamentEmailSettings).where(
                TournamentEmailSettings.tournament_id == tournament_id
            )
        )
        tournament_enabled = {r.email_type: r.enabled for r in t_res.scalars().all()}

    return [
        {
            "email_type": et.value,
            "opted_in": rows.get(et, False),
            "tournament_enabled": tournament_enabled.get(et, tournament_id is None),
        }
        for et in EmailType
    ]


class EmailPreferenceUpdate(BaseModel):
    preferences: list[dict]  # [{email_type: str, opted_in: bool}]
    tournament_id: Optional[int] = None


@router.put("/me/email-preferences", response_model=dict)
async def update_email_preferences(
    payload: EmailPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Build set of types disabled at tournament level
    disabled_types: set[EmailType] = set()
    if payload.tournament_id is not None:
        t_res = await db.execute(
            select(TournamentEmailSettings).where(
                TournamentEmailSettings.tournament_id == payload.tournament_id
            )
        )
        enabled_map = {r.email_type: r.enabled for r in t_res.scalars().all()}
        for et in EmailType:
            if not enabled_map.get(et, False):
                disabled_types.add(et)

    valid_types = {et.value for et in EmailType}
    for pref in payload.preferences:
        et_str = pref.get("email_type")
        opted_in = pref.get("opted_in")
        if et_str not in valid_types or not isinstance(opted_in, bool):
            continue
        email_type = EmailType(et_str)
        if email_type in disabled_types:
            continue
        res = await db.execute(
            select(UserEmailPreference).where(
                UserEmailPreference.user_id == current_user.id,
                UserEmailPreference.email_type == email_type,
            )
        )
        row = res.scalar_one_or_none()
        if row:
            row.opted_in = opted_in
        else:
            db.add(UserEmailPreference(
                user_id=current_user.id,
                email_type=email_type,
                opted_in=opted_in,
            ))
    await db.commit()
    return {"message": "Email preferences updated"}


@router.put("/me/profile", response_model=dict)
async def update_profile(
    payload: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Allow any user to update their display name, email, and password."""
    # 1. If email is changing, ensure it is unique
    if payload.email != current_user.email:
        res = await db.execute(select(User).where(User.email == payload.email))
        existing_user = res.scalar_one_or_none()
        if existing_user:
            raise HTTPException(status_code=400, detail="This email is already in use by another account.")
        current_user.email = payload.email

    # 2. Update display name and team name
    current_user.display_name = payload.display_name
    current_user.team_name = payload.team_name

    # 3. If password change is requested, verify current password first
    if payload.new_password:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="You must provide your current password to change your password.")
        if not verify_password(payload.current_password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect current password.")
        current_user.hashed_password = get_password_hash(payload.new_password)

    await db.commit()
    await db.refresh(current_user)
    
    response = {"message": "Profile updated successfully"}
    if payload.new_password:
        from core.security import create_access_token
        response["access_token"] = create_access_token(
            subject=current_user.id,
            password_hash=current_user.hashed_password
        )
    return response


@router.delete("/me", response_model=dict)
async def delete_current_user_account(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete current user's profile and related predictions, transfer or delete leagues."""
    from models.league import League
    from models.league_member import LeagueMember
    from models.match_prediction import MatchPrediction
    from models.bracket_prediction import BracketPrediction
    from models.historical_ranking import HistoricalRanking
    from models.invitation import Invitation
    from sqlalchemy import delete

    user_id = current_user.id

    # 1. Handle leagues created by this user
    leagues_created_res = await db.execute(
        select(League).where(League.created_by == user_id)
    )
    leagues_created = leagues_created_res.scalars().all()

    for league in leagues_created:
        # Check if there are other members
        members_res = await db.execute(
            select(LeagueMember).where(
                LeagueMember.league_id == league.id,
                LeagueMember.user_id != user_id
            ).order_by(LeagueMember.joined_at.asc())
        )
        other_members = members_res.scalars().all()

        if other_members:
            # Transfer ownership to the oldest member
            league.created_by = other_members[0].user_id
            db.add(league)
        else:
            # Dissolve league: delete invitations, historical rankings, and memberships
            await db.execute(delete(Invitation).where(Invitation.league_id == league.id))
            await db.execute(delete(HistoricalRanking).where(HistoricalRanking.league_id == league.id))
            await db.execute(delete(LeagueMember).where(LeagueMember.league_id == league.id))
            await db.execute(delete(League).where(League.id == league.id))

    # 2. Reset claimed invitations
    claimed_invitations_res = await db.execute(
        select(Invitation).where(Invitation.claimed_by == user_id)
    )
    claimed_invitations = claimed_invitations_res.scalars().all()
    for inv in claimed_invitations:
        inv.claimed_by = None
        inv.claimed_at = None
        db.add(inv)

    # 3. Delete invitations created by this user
    await db.execute(delete(Invitation).where(Invitation.created_by == user_id))

    # 4. Delete user-specific rows
    await db.execute(delete(UserEmailPreference).where(UserEmailPreference.user_id == user_id))
    await db.execute(delete(LeagueMember).where(LeagueMember.user_id == user_id))
    await db.execute(delete(MatchPrediction).where(MatchPrediction.user_id == user_id))
    await db.execute(delete(HistoricalRanking).where(HistoricalRanking.user_id == user_id))
    await db.execute(delete(UserPointsLedger).where(UserPointsLedger.user_id == user_id))

    # 5. Delete bracket predictions and picks
    brackets_res = await db.execute(
        select(BracketPrediction).where(BracketPrediction.user_id == user_id)
    )
    brackets = brackets_res.scalars().all()
    for bracket in brackets:
        await db.delete(bracket)

    # 6. Delete the user
    await db.delete(current_user)
    await db.commit()

    return {"message": "Account deleted successfully"}
