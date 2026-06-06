import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from api.deps import get_db, get_current_user
from models.bracket_prediction import BracketPrediction
from models.bracket_group_pick import BracketGroupPick
from models.bracket_ko_pick import BracketKoPick, KoRound
from models.fixture import Fixture, FixtureStage, FixtureStatus
from models.tournament import Tournament
from models.user import User
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from schemas.bracket import BracketPredictionCreate, BracketPredictionResponse, BracketPointsBreakdown, KoStageDetail
from services.tournaments import resolve_tournament_id, resolve_bracket_lock_time

# Window during which bracket submissions are rejected after an admin reset.
# Defeats the BracketBuilder auto-save (1.5 s debounce) re-creating a deleted bracket.
BRACKET_RESET_COOLDOWN_SECONDS = 30


# (stage, ko_round for picks, pts_per_team, user pick slots, label)
_STANDARD_KO_STAGES = [
    (FixtureStage.round_32,     KoRound.round_32,     3,  16, "Teams progressing to Round of 16"),
    (FixtureStage.round_16,     KoRound.round_16,     5,   8, "Teams progressing to Quarter Finals"),
    (FixtureStage.quarter_final, KoRound.quarter_final, 8, 4, "Teams progressing to Semi-Finals"),
    (FixtureStage.semi_final,   KoRound.semi_final,   12,  2, "Teams progressing to Final"),
]


def _fixture_winner(f: Fixture) -> str | None:
    if f.knockout_winner:
        return f.knockout_winner
    if f.home_score is None or f.away_score is None:
        return None
    return f.home_team if f.home_score > f.away_score else (f.away_team if f.away_score > f.home_score else None)


def _build_ko_stage_details(
    ko_picks: list[BracketKoPick],
    fixtures: list[Fixture],
    ko_pts: dict[str, int],
    actual_3p_qualifiers: set[str] | None = None,
) -> list[KoStageDetail]:
    details: list[KoStageDetail] = []

    # 3rd Place Qualifiers — the 8 group-stage third-place teams that advance to R32
    third_picks = sorted({p.predicted_team for p in ko_picks if p.slot.endswith("-3P")})
    r32_fixtures = [f for f in fixtures if f.stage == FixtureStage.round_32]
    r32_completed = bool(r32_fixtures) and all(f.status == FixtureStatus.completed for f in r32_fixtures)
    if actual_3p_qualifiers is not None:
        actual_3p = sorted(actual_3p_qualifiers)
    else:
        # Fallback: all R32 participants (over-counts but better than nothing)
        r32_teams = {f.home_team for f in r32_fixtures if f.status == FixtureStatus.completed} | \
                    {f.away_team for f in r32_fixtures if f.status == FixtureStatus.completed}
        actual_3p = sorted(r32_teams)
    matched_3p = sorted(set(third_picks) & set(actual_3p))
    details.append(KoStageDetail(
        stage="third_place_qualifiers",
        label="3rd place teams advancing to R32",
        completed=r32_completed,
        predicted_teams=third_picks,
        actual_teams=actual_3p,
        matched_teams=matched_3p,
        points=len(matched_3p) * 3,
        pts_per_team=3,
        total_slots=8,
    ))

    for fix_stage, ko_round, pts_per_team, total_slots, label in _STANDARD_KO_STAGES:
        stage_fixtures = [f for f in fixtures if f.stage == fix_stage]
        completed = bool(stage_fixtures) and all(f.status == FixtureStatus.completed for f in stage_fixtures)
        actual_teams = sorted({_fixture_winner(f) for f in stage_fixtures if f.status == FixtureStatus.completed} - {None})
        # Exclude -3P picks (shown in the dedicated 3rd Place Qualifiers section above)
        predicted_teams = sorted({p.predicted_team for p in ko_picks
                                   if p.round == ko_round and not p.slot.endswith("-3P")})
        matched_teams = sorted(set(predicted_teams) & set(actual_teams))
        details.append(KoStageDetail(
            stage=fix_stage.value,
            label=label,
            completed=completed,
            predicted_teams=predicted_teams,
            actual_teams=actual_teams,
            matched_teams=matched_teams,
            points=len(matched_teams) * pts_per_team,
            pts_per_team=pts_per_team,
            total_slots=total_slots,
        ))

    # 3rd Place Playoff
    third_fixture = next((f for f in fixtures if f.stage == FixtureStage.third_place), None)
    third_pick = next((p.predicted_team for p in ko_picks if p.round == KoRound.third_place), None)
    actual_third = _fixture_winner(third_fixture) if third_fixture else None
    third_completed = bool(third_fixture and third_fixture.status == FixtureStatus.completed)
    matched_third = [actual_third] if (actual_third and third_pick == actual_third) else []
    third_pts = len(matched_third) * 8

    details.append(KoStageDetail(
        stage="third_place",
        label="3rd place winner",
        completed=third_completed,
        predicted_teams=sorted(filter(None, [third_pick])),
        actual_teams=sorted(filter(None, [actual_third])),
        matched_teams=sorted(matched_third),
        points=third_pts,
        pts_per_team=8,
        total_slots=1,
    ))

    # Final
    final_fixture = next((f for f in fixtures if f.stage == FixtureStage.final), None)
    champion_pick = next((p.predicted_team for p in ko_picks if p.round == KoRound.final), None)
    actual_champion = _fixture_winner(final_fixture) if final_fixture else None
    final_completed = bool(final_fixture and final_fixture.status == FixtureStatus.completed)
    matched_final = [actual_champion] if (actual_champion and champion_pick == actual_champion) else []
    # Finals ledger entry includes both the final and 3rd place. Subtract 3rd place pts here.
    final_pts = max(0, ko_pts.get("finals", 0) - third_pts)

    details.append(KoStageDetail(
        stage="final",
        label="Tournament Winner",
        completed=final_completed,
        predicted_teams=sorted(filter(None, [champion_pick])),
        actual_teams=sorted(filter(None, [actual_champion])),
        matched_teams=sorted(matched_final),
        points=final_pts,
        pts_per_team=None,
        total_slots=1,
    ))

    return details

router = APIRouter()

@router.post("", response_model=BracketPredictionResponse)
async def submit_bracket(
    bracket_in: BracketPredictionCreate,
    tournament_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    t_id = await resolve_tournament_id(db, tournament_id)

    lock_time = await resolve_bracket_lock_time(db, t_id)
    if datetime.now(timezone.utc) >= lock_time:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Tournament has started, bracket is locked.")

    reset_at = (await db.execute(
        select(Tournament.predictions_reset_at).where(Tournament.id == t_id)
    )).scalar_one_or_none()
    if reset_at is not None:
        elapsed = (datetime.now(timezone.utc) - reset_at).total_seconds()
        if elapsed < BRACKET_RESET_COOLDOWN_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tournament was just reset by an admin. Refresh the bracket page before submitting again.",
            )

    # Check if bracket already exists for this user in this tournament
    stmt = select(BracketPrediction).where(
        BracketPrediction.user_id == current_user.id,
        BracketPrediction.tournament_id == t_id
    )
    existing_bracket = (await db.execute(stmt)).scalar_one_or_none()
    
    if existing_bracket:
        if existing_bracket.is_locked:
             raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Your bracket is already locked.")
        await db.delete(existing_bracket)
        await db.commit()
        
    new_bracket = BracketPrediction(user_id=current_user.id, tournament_id=t_id)
    db.add(new_bracket)
    await db.flush() # flush to get new_bracket.id
    
    for pick in bracket_in.group_picks:
        db.add(BracketGroupPick(
            bracket_id=new_bracket.id,
            group_code=pick.group_code,
            position=pick.position,
            predicted_team=pick.predicted_team
        ))
        
    for pick in bracket_in.ko_picks:
        db.add(BracketKoPick(
            bracket_id=new_bracket.id,
            round=pick.round,
            slot=pick.slot,
            predicted_team=pick.predicted_team
        ))
        
    await db.commit()
    await db.refresh(new_bracket)
    
    from sqlalchemy.orm import selectinload
    stmt = select(BracketPrediction).where(BracketPrediction.id == new_bracket.id).options(
        selectinload(BracketPrediction.group_picks),
        selectinload(BracketPrediction.ko_picks)
    )
    bracket_full = (await db.execute(stmt)).scalar_one()
    return bracket_full

@router.get("/me", response_model=BracketPredictionResponse)
async def get_my_bracket(
    tournament_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    t_id = await resolve_tournament_id(db, tournament_id)
    from sqlalchemy.orm import selectinload
    stmt = select(BracketPrediction).where(
        BracketPrediction.user_id == current_user.id,
        BracketPrediction.tournament_id == t_id
    ).options(
        selectinload(BracketPrediction.group_picks),
        selectinload(BracketPrediction.ko_picks)
    )
    bracket = (await db.execute(stmt)).scalar_one_or_none()
    if not bracket:
        raise HTTPException(status_code=404, detail="Bracket not found")

    ledger_res = await db.execute(
        select(UserPointsLedger).where(
            UserPointsLedger.user_id == current_user.id,
            UserPointsLedger.tournament_id == t_id,
            UserPointsLedger.source_type.in_([PointsSourceType.group_bracket, PointsSourceType.ko_bracket]),
        )
    )
    groups_pts: dict[str, int] = {}
    ko_pts: dict[str, int] = {}
    for entry in ledger_res.scalars().all():
        if entry.source_type == PointsSourceType.group_bracket:
            groups_pts[entry.source_id] = groups_pts.get(entry.source_id, 0) + entry.points_awarded
        else:
            stage = entry.source_id.split(":")[0]
            ko_pts[stage] = ko_pts.get(stage, 0) + entry.points_awarded

    all_fixtures_res = await db.execute(
        select(Fixture).where(Fixture.tournament_id == t_id)
    )
    all_fixtures = list(all_fixtures_res.scalars().all())
    ko_fixtures = [f for f in all_fixtures if f.stage != FixtureStage.group]
    group_fixtures = [f for f in all_fixtures if f.stage == FixtureStage.group]

    # Identify actual 3rd-place qualifiers: R32 participants that aren't top-2 in any group
    group_stats: dict[str, dict[str, dict]] = {}
    for f in group_fixtures:
        if f.status != FixtureStatus.completed or f.home_score is None or f.away_score is None or not f.group_code:
            continue
        grp = f.group_code
        if grp not in group_stats:
            group_stats[grp] = {}
        for team, scored, conceded in [(f.home_team, f.home_score, f.away_score), (f.away_team, f.away_score, f.home_score)]:
            if team not in group_stats[grp]:
                group_stats[grp][team] = {"pts": 0, "gd": 0, "gf": 0}
            if scored > conceded:
                group_stats[grp][team]["pts"] += 3
            elif scored == conceded:
                group_stats[grp][team]["pts"] += 1
            group_stats[grp][team]["gd"] += scored - conceded
            group_stats[grp][team]["gf"] += scored

    top2_teams: set[str] = set()
    for grp, teams in group_stats.items():
        ranked = sorted(teams, key=lambda t: (-teams[t]["pts"], -teams[t]["gd"], -teams[t]["gf"]))
        top2_teams.update(ranked[:2])

    r32_teams: set[str] = set()
    for f in ko_fixtures:
        if f.stage == FixtureStage.round_32 and f.status == FixtureStatus.completed:
            r32_teams.add(f.home_team)
            r32_teams.add(f.away_team)

    actual_3p_qualifiers = r32_teams - top2_teams if top2_teams else None

    ko_stage_details = _build_ko_stage_details(list(bracket.ko_picks), ko_fixtures, ko_pts, actual_3p_qualifiers)

    return {
        "id": bracket.id,
        "user_id": bracket.user_id,
        "tournament_id": bracket.tournament_id,
        "is_locked": bracket.is_locked,
        "total_points": bracket.total_points,
        "submitted_at": bracket.submitted_at,
        "updated_at": bracket.updated_at,
        "group_picks": [
            {"id": p.id, "group_code": p.group_code, "position": p.position, "predicted_team": p.predicted_team}
            for p in bracket.group_picks
        ],
        "ko_picks": [
            {"id": p.id, "round": p.round, "slot": p.slot, "predicted_team": p.predicted_team}
            for p in bracket.ko_picks
        ],
        "points_breakdown": {
            "groups": groups_pts,
            "ko_stages": ko_pts,
            "ko_stage_details": [d.model_dump() for d in ko_stage_details],
        },
    }


@router.delete("/clear")
async def clear_bracket(
    tournament_id: int | None = None,
    type: str = "all",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clears bracket predictions (all, group picks, or knockout picks) if the window is open.
    """
    tournament_id = await resolve_tournament_id(db, tournament_id)
    lock_time = await resolve_bracket_lock_time(db, tournament_id)
    if datetime.now(timezone.utc) >= lock_time:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Tournament has started, bracket is locked.")

    # Find the bracket prediction
    stmt = select(BracketPrediction).where(
        BracketPrediction.user_id == current_user.id,
        BracketPrediction.tournament_id == tournament_id
    )
    bracket = (await db.execute(stmt)).scalar_one_or_none()
    if not bracket:
        raise HTTPException(status_code=404, detail="No bracket prediction found to clear.")

    if bracket.is_locked:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Your bracket is locked and cannot be cleared.")

    from sqlalchemy import delete
    from models.bracket_group_pick import BracketGroupPick
    from models.bracket_ko_pick import BracketKoPick

    if type == "all":
        await db.delete(bracket)
    elif type == "group":
        await db.execute(delete(BracketGroupPick).where(BracketGroupPick.bracket_id == bracket.id))
        await db.execute(delete(BracketKoPick).where(BracketKoPick.bracket_id == bracket.id))
    elif type == "knockout":
        stmt_del = delete(BracketKoPick).where(BracketKoPick.bracket_id == bracket.id)
        await db.execute(stmt_del)
    else:
        raise HTTPException(status_code=400, detail="Invalid clear type. Must be 'all', 'group', or 'knockout'.")

    await db.commit()
    return {"message": f"Successfully cleared bracket prediction (type: {type})."}


_ACTUAL_RESULTS_CACHE_TTL = 60  # seconds
_ACTUAL_RESULTS_CACHE_KEY = "cache:bracket:actual_results:{tournament_id}"


@router.get("/actual-results")
async def get_actual_ko_results(
    tournament_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return actual group standings and slot-mapped KO results as the tournament progresses."""
    from core.redis_client import redis_client as _redis

    t_id = await resolve_tournament_id(db, tournament_id)

    cache_key = _ACTUAL_RESULTS_CACHE_KEY.format(tournament_id=t_id)
    cached = await _redis.get(cache_key)
    if cached:
        from fastapi.responses import Response
        return Response(content=cached, media_type="application/json")
    all_fixtures = list((await db.execute(
        select(Fixture).where(Fixture.tournament_id == t_id)
    )).scalars().all())

    group_fixtures = [f for f in all_fixtures if f.stage == FixtureStage.group]
    ko_fixtures    = [f for f in all_fixtures if f.stage != FixtureStage.group]

    # ── Actual group standings ──────────────────────────────────────────────
    group_stats: dict[str, dict[str, dict]] = {}
    for f in group_fixtures:
        if f.status != FixtureStatus.completed or f.home_score is None or not f.group_code:
            continue
        grp = f.group_code
        if grp not in group_stats:
            group_stats[grp] = {}
        for team, scored, conceded in [
            (f.home_team, f.home_score, f.away_score),
            (f.away_team, f.away_score, f.home_score),
        ]:
            if team not in group_stats[grp]:
                group_stats[grp][team] = {"pts": 0, "gd": 0, "gf": 0}
            if scored > conceded:
                group_stats[grp][team]["pts"] += 3
            elif scored == conceded:
                group_stats[grp][team]["pts"] += 1
            group_stats[grp][team]["gd"] += scored - conceded
            group_stats[grp][team]["gf"] += scored

    actual_standings: dict[str, list[str]] = {
        grp: sorted(teams, key=lambda t: (-teams[t]["pts"], -teams[t]["gd"], -teams[t]["gf"]))
        for grp, teams in group_stats.items()
    }

    # ── Map fixtures to slots by kickoff order ─────────────────────────────
    # Fixtures at each stage are populated in bracket order by advance_stage,
    # so sorting by kickoff_time gives the correct slot mapping directly.
    # This avoids the fragile group-standings → team-pair lookup chain that
    # broke whenever the seeding logic differed between simulate.py and here.

    SlotResult = dict  # {team_a, team_b, winner, status}
    slot_results: dict[str, SlotResult] = {}

    def make_result(team_a: str | None, team_b: str | None, fx: Fixture | None) -> SlotResult:
        return {
            "team_a": team_a,
            "team_b": team_b,
            "winner": _fixture_winner(fx) if fx else None,
            "status": fx.status.value if fx else "scheduled",
        }

    stage_slot_names: list[tuple[FixtureStage, list[str]]] = [
        (FixtureStage.round_32,      [f'R32-{i}' for i in range(1, 17)]),
        (FixtureStage.round_16,      [f'R16-{i}' for i in range(1, 9)]),
        (FixtureStage.quarter_final, [f'QF-{i}'  for i in range(1, 5)]),
        (FixtureStage.semi_final,    ['SF-1', 'SF-2']),
        (FixtureStage.final,         ['FINAL']),
        (FixtureStage.third_place,   ['3RD']),
    ]

    for stage_enum, slots in stage_slot_names:
        stage_fixtures = sorted(
            [f for f in ko_fixtures if f.stage == stage_enum],
            key=lambda f: f.kickoff_time,
        )
        for i, slot in enumerate(slots):
            fx = stage_fixtures[i] if i < len(stage_fixtures) else None
            if fx:
                slot_results[slot] = make_result(fx.home_team, fx.away_team, fx)
            else:
                slot_results[slot] = make_result(None, None, None)

    payload = {"group_standings": actual_standings, "slots": slot_results}
    serialised = json.dumps(payload)
    await _redis.set(cache_key, serialised, ex=_ACTUAL_RESULTS_CACHE_TTL)
    return payload
