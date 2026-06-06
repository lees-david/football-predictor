"""
Simulation endpoints — admin-only tools for testing the scoring pipeline
before real fixtures have been played.

Endpoints:
  GET  /admin/simulate/fixtures                       List all fixtures with current scores/status
  POST /admin/simulate/fixture/{id}/result            Set a score and mark as completed, dispatch grading
  POST /admin/simulate/fixture/{id}/reset             Reverse points, clear score, reopen for editing
  POST /admin/simulate/group/{group_code}/complete    Fast-forward an entire group to completed (random scores)
  POST /admin/simulate/stage/{stage}/advance          Populate next-stage fixture teams from completed stage results
  POST /admin/simulate/stage/{stage}/complete         Complete all fixtures in a KO stage with random scores
"""

from __future__ import annotations

import logging
import random
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_current_admin
from core.redis_client import redis_client
from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.match_prediction import MatchPrediction
from models.tournament import Tournament
from models.user import User
from models.league_member import LeagueMember
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from services.leaderboard import update_user_score
from workers.points_recalc import recompute_users_in_session
from services.group_tiebreakers import rank_teams_in_group
from workers.bracket_engine import _resolve_completed_fixture, _resolve_group_standings, _resolve_ko_stage

logger = logging.getLogger(__name__)

router = APIRouter()

_GROUP_GRADED_KEY = "grading:group:{group_code}:graded"

# ---------------------------------------------------------------------------
# R32 seeding constants mapping index in r32_fixtures (Match 73 to 88)
# R32_CERTAIN_SEEDING: (match_index, home_group, home_pos, away_group, away_pos)
# R32_THIRD_PLACE_SEEDING: (match_index, winner_group, eligible_3rd_groups)
#   eligible_3rd_groups — the FIFA Annex C pool of source groups from which the
#   3rd-place opponent for this slot may come (exactly 5 groups per slot).
# ---------------------------------------------------------------------------
R32_CERTAIN_SEEDING = [
    (0, "A", 2, "B", 2),  # Match 73: Runner-up A vs Runner-up B
    (1, "C", 1, "F", 2),  # Match 74: Winner C vs Runner-up F
    (3, "F", 1, "C", 2),  # Match 76: Winner F vs Runner-up C
    (4, "E", 2, "I", 2),  # Match 77: Runner-up E vs Runner-up I
    (10, "H", 1, "J", 2), # Match 83: Winner H vs Runner-up J
    (11, "K", 2, "L", 2), # Match 84: Runner-up K vs Runner-up L
    (13, "D", 2, "G", 2), # Match 86: Runner-up D vs Runner-up G
    (14, "J", 1, "H", 2), # Match 87: Winner J vs Runner-up H
]

# Each entry: (r32_fixture_index, winner_group, [eligible 3rd-place source groups])
# Source pools are per the official FIFA World Cup 2026 competition regulations (Annex C).
R32_THIRD_PLACE_SEEDING: list[tuple[int, str, list[str]]] = [
    (2,  "E", ["A", "B", "C", "D", "F"]),  # Match 75: 1st E vs 3rd A/B/C/D/F
    (5,  "I", ["C", "D", "F", "G", "H"]),  # Match 78: 1st I vs 3rd C/D/F/G/H
    (6,  "A", ["C", "E", "F", "H", "I"]),  # Match 79: 1st A vs 3rd C/E/F/H/I
    (7,  "L", ["E", "H", "I", "J", "K"]),  # Match 80: 1st L vs 3rd E/H/I/J/K
    (8,  "G", ["A", "E", "H", "I", "J"]),  # Match 81: 1st G vs 3rd A/E/H/I/J
    (9,  "D", ["B", "E", "F", "I", "J"]),  # Match 82: 1st D vs 3rd B/E/F/I/J
    (12, "B", ["E", "F", "G", "I", "J"]),  # Match 85: 1st B vs 3rd E/F/G/I/J
    (15, "K", ["D", "E", "I", "J", "L"]),  # Match 88: 1st K vs 3rd D/E/I/J/L
]

# KO stage progression chain (string key → next FixtureStage enum)
STAGE_CHAIN = {
    "group":         FixtureStage.round_32,
    "round_32":      FixtureStage.round_16,
    "round_16":      FixtureStage.quarter_final,
    "quarter_final": FixtureStage.semi_final,
    "semi_final":    None,  # produces final + third_place
}

# All stages in elimination order — used for reset guards
STAGE_SEQUENCE = [
    FixtureStage.group,
    FixtureStage.round_32,
    FixtureStage.round_16,
    FixtureStage.quarter_final,
    FixtureStage.semi_final,
    FixtureStage.third_place,
    FixtureStage.final,
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SCORE_POOL = [
    (0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (0, 2), (2, 1), (1, 2),
    (2, 2), (3, 0), (0, 3), (3, 1), (1, 3), (3, 2), (2, 3),
    (4, 0), (0, 4), (4, 1), (1, 4),
]
_SCORE_WEIGHTS = [
    3, 12, 12, 9, 8, 8, 10, 10,
    4, 5, 5, 5, 5, 3, 3,
    1, 1, 1, 1,
]


def _random_score() -> tuple[int, int]:
    """Return a weighted-random realistic football scoreline."""
    return random.choices(_SCORE_POOL, weights=_SCORE_WEIGHTS, k=1)[0]


def _random_ko_result(home_team: str, away_team: str) -> tuple[int, int, int | None, int | None, str | None]:
    """Return (home_ft, away_ft, home_aet, away_aet, knockout_winner) for a KO fixture.

    Scenarios (weighted):
      60% — 90-min win (no draw)
      20% — AET win (FT draw, one goal in extra time)
      20% — Penalties (FT draw, AET draw, random winner)
    """
    scenario = random.choices(['ft_win', 'aet_win', 'pens'], weights=[60, 20, 20])[0]

    if scenario == 'ft_win':
        home, away = _random_score()
        while home == away:
            home, away = _random_score()
        return home, away, None, None, None

    ft = random.randint(0, 2)  # FT draw score (0-0, 1-1, or 2-2)

    if scenario == 'aet_win':
        if random.random() < 0.5:
            winner = home_team
            return ft, ft, ft + 1, ft, winner
        else:
            winner = away_team
            return ft, ft, ft, ft + 1, winner

    # Penalties
    winner = random.choice([home_team, away_team])
    return ft, ft, ft, ft, winner


def _get_winner(fixture: Fixture) -> str | None:
    if fixture.knockout_winner:
        return fixture.knockout_winner
    if fixture.home_score is None or fixture.away_score is None:
        return None
    if fixture.home_score > fixture.away_score:
        return fixture.home_team
    if fixture.away_score > fixture.home_score:
        return fixture.away_team
    # Tied — in KO stages, randomly pick a winner (penalty shootout simulation)
    return random.choice([fixture.home_team, fixture.away_team])


def _get_loser(fixture: Fixture) -> str | None:
    winner = _get_winner(fixture)
    if winner is None:
        return None
    return fixture.away_team if winner == fixture.home_team else fixture.home_team


async def _compute_all_group_standings(db: AsyncSession, tournament_id: int) -> dict[str, dict[str, int]]:
    """
    Returns {group_code: {team_name: final_position (1-indexed)}} for all groups,
    applying the full FIFA tiebreaker chain (pts → GD → GF → H2H → Wikipedia).
    """
    fixtures_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == FixtureStage.group,
            Fixture.status == FixtureStatus.completed,
        )
    )
    fixtures = list(fixtures_res.scalars().all())

    tourn_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
    tournament = tourn_res.scalar_one_or_none()
    season = tournament.api_season if tournament else None

    # Accumulate overall pts/GD/GF per group and remember fixtures per group for H2H
    group_stats: dict[str, dict[str, dict]] = {}
    group_fixtures: dict[str, list] = {}
    for f in fixtures:
        g = f.group_code
        if not g:
            continue
        group_stats.setdefault(g, {})
        group_fixtures.setdefault(g, []).append(f)
        for team, scored, conceded in [
            (f.home_team, f.home_score, f.away_score),
            (f.away_team, f.away_score, f.home_score),
        ]:
            if team not in group_stats[g]:
                group_stats[g][team] = {"pts": 0, "gd": 0, "gf": 0}
            if scored is None or conceded is None:
                continue
            if scored > conceded:
                group_stats[g][team]["pts"] += 3
            elif scored == conceded:
                group_stats[g][team]["pts"] += 1
            group_stats[g][team]["gd"] += scored - conceded
            group_stats[g][team]["gf"] += scored

    result: dict[str, dict[str, int]] = {}
    for g, stats in group_stats.items():
        sorted_teams = rank_teams_in_group(stats, group_fixtures.get(g, []), g, season)
        result[g] = {team: pos + 1 for pos, team in enumerate(sorted_teams)}

    return result


async def _advance_ko_stage(stage_enum: FixtureStage, tournament_id: int, db: AsyncSession) -> int:
    """
    Populate the next stage's fixture team names from winners of stage_enum.
    Returns the number of next-stage fixtures updated.
    Called automatically after a KO stage is fully completed.
    """
    stage_str = stage_enum.value
    completed_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == stage_enum,
            Fixture.status == FixtureStatus.completed,
        ).order_by(Fixture.kickoff_time)
    )
    completed = list(completed_res.scalars().all())
    if not completed:
        return 0

    logo_map: dict[str, str] = {}
    for f in completed:
        if f.home_logo: logo_map[f.home_team] = f.home_logo
        if f.away_logo: logo_map[f.away_team] = f.away_logo

    # Semi-final → Final + 3rd place
    if stage_str == "semi_final":
        if len(completed) < 2:
            return 0
        sf1, sf2 = completed[0], completed[1]
        updates = [
            (FixtureStage.final, _get_winner(sf1), _get_winner(sf2)),
            (FixtureStage.third_place, _get_loser(sf1), _get_loser(sf2)),
        ]
        updated = 0
        for next_stage, home_name, away_name in updates:
            if not home_name or not away_name:
                continue
            res = await db.execute(
                select(Fixture).where(
                    Fixture.tournament_id == tournament_id,
                    Fixture.stage == next_stage,
                ).order_by(Fixture.kickoff_time).limit(1)
            )
            nf = res.scalar_one_or_none()
            if nf:
                nf.home_team = home_name
                nf.away_team = away_name
                nf.home_logo = logo_map.get(home_name)
                nf.away_logo = logo_map.get(away_name)
                updated += 1
        return updated

    next_stage = STAGE_CHAIN.get(stage_str)
    if next_stage is None:
        return 0

    next_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == next_stage,
        ).order_by(Fixture.kickoff_time)
    )
    next_fixtures = list(next_res.scalars().all())

    # Map of source R32 match indices (Match 73-88) to next R16 fixture indices (Match 89-96)
    r32_to_r16_map = [
        (0, 2),   # R16 Match 89 feeds from Match 73 (0) and Match 75 (2)
        (1, 4),   # R16 Match 90 feeds from Match 74 (1) and Match 77 (4)
        (3, 5),   # R16 Match 91 feeds from Match 76 (3) and Match 78 (5)
        (6, 7),   # R16 Match 92 feeds from Match 79 (6) and Match 80 (7)
        (10, 11), # R16 Match 93 feeds from Match 83 (10) and Match 84 (11)
        (8, 9),   # R16 Match 94 feeds from Match 81 (8) and Match 82 (9)
        (13, 15), # R16 Match 95 feeds from Match 86 (13) and Match 88 (15)
        (12, 14), # R16 Match 96 feeds from Match 85 (12) and Match 87 (14)
    ]

    updated = 0
    for i, nf in enumerate(next_fixtures):
        if stage_str == "round_32" and i < len(r32_to_r16_map):
            home_src, away_src = r32_to_r16_map[i]
        else:
            home_src, away_src = i * 2, i * 2 + 1

        if home_src < len(completed):
            name = _get_winner(completed[home_src])
            if name:
                nf.home_team = name
                nf.home_logo = logo_map.get(name)
        if away_src < len(completed):
            name = _get_winner(completed[away_src])
            if name:
                nf.away_team = name
                nf.away_logo = logo_map.get(name)
        updated += 1

    return updated


def _assign_third_place_teams(
    ranked_thirds: list[tuple[str, str]],
    seeding: list[tuple[int, str, list[str]]],
) -> dict[int, str]:
    """
    Assign the 8 best 3rd-place teams to their R32 match slots using the FIFA
    Annex C eligibility constraints.

    Each R32 slot may only receive a 3rd-place team whose source group is in
    that slot's pre-defined eligible pool. This prevents, e.g., the 3rd-place
    team from Group J being placed into Match 75 which only accepts A/B/C/D/F.

    Algorithm: greedy "most-constrained slot first".
      1. Build a set of qualifying groups from ranked_thirds.
      2. Repeatedly select the slot with the *fewest* remaining eligible teams
         (breaking ties by original seeding order) and assign the highest-ranked
         team from that slot's eligible pool.
      3. Remove the assigned team from the pool and repeat.

    Args:
        ranked_thirds: (group_code, team_name) pairs ordered best-first (rank 1…8).
        seeding: R32_THIRD_PLACE_SEEDING entries — (r32_idx, winner_group, eligible_groups).

    Returns:
        dict mapping r32_fixture_index → team_name for all 8 slots.
        If a slot cannot be filled (should not happen with valid input) it is omitted.
    """
    # Track unassigned teams as an ordered list (index 0 = best rank)
    remaining: list[tuple[str, str]] = list(ranked_thirds)
    # Slots not yet assigned: list of (original_position, r32_idx, winner_group, eligible_groups)
    open_slots: list[tuple[int, int, str, list[str]]] = [
        (i, r32_idx, wg, eg) for i, (r32_idx, wg, eg) in enumerate(seeding)
    ]
    assignment: dict[int, str] = {}

    while open_slots and remaining:
        # Count how many remaining teams are eligible for each open slot
        def _eligible_count(slot_entry: tuple[int, int, str, list[str]]) -> tuple[int, int]:
            _, _, _, eg = slot_entry
            eligible_set = set(eg)
            count = sum(1 for g, _ in remaining if g in eligible_set)
            original_pos = slot_entry[0]
            return (count, original_pos)  # sort: fewest first, then original order

        open_slots.sort(key=_eligible_count)
        orig_pos, r32_idx, _wg, eligible_groups = open_slots.pop(0)

        eligible_set = set(eligible_groups)
        assigned = False
        for i, (group, team) in enumerate(remaining):
            if group in eligible_set:
                assignment[r32_idx] = team
                remaining.pop(i)
                assigned = True
                break

        if not assigned:
            logger.warning(
                "_assign_third_place_teams: no eligible team found for R32 slot index %d "
                "(eligible groups: %s, remaining groups: %s)",
                r32_idx,
                eligible_groups,
                [g for g, _ in remaining],
            )

    return assignment


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SetResultRequest(BaseModel):
    home_score: int = Field(..., ge=0, le=20)
    away_score: int = Field(..., ge=0, le=20)
    # Extra time scores — only set if the match went beyond 90 mins.
    home_score_aet: Optional[int] = Field(None, ge=0, le=20)
    away_score_aet: Optional[int] = Field(None, ge=0, le=20)
    # For KO fixtures settled by penalties: set to the home or away team name.
    # For AET wins this is auto-derived from home/away_score_aet if not provided.
    knockout_winner: Optional[str] = None


class FixtureSimState(BaseModel):
    id: int
    stage: str
    group_code: Optional[str]
    matchday: Optional[int]
    home_team: str
    away_team: str
    kickoff_time: str
    status: str
    home_score: Optional[int]
    away_score: Optional[int]
    home_score_aet: Optional[int]
    away_score_aet: Optional[int]
    knockout_winner: Optional[str]

    model_config = {"from_attributes": True}


class GroupCompleteRequest(BaseModel):
    scores: list[dict] = []


# ---------------------------------------------------------------------------
# GET /admin/simulate/fixtures
# ---------------------------------------------------------------------------

@router.get("/fixtures", response_model=list[FixtureSimState])
async def list_sim_fixtures(
    tournament_id: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(
        select(Fixture)
        .where(Fixture.tournament_id == tournament_id)
        .order_by(Fixture.stage, Fixture.kickoff_time)
    )
    fixtures = res.scalars().all()
    return [
        FixtureSimState(
            id=f.id,
            stage=f.stage.value,
            group_code=f.group_code,
            matchday=f.matchday,
            home_team=f.home_team,
            away_team=f.away_team,
            kickoff_time=f.kickoff_time.isoformat(),
            status=f.status.value,
            home_score=f.home_score,
            away_score=f.away_score,
            home_score_aet=f.home_score_aet,
            away_score_aet=f.away_score_aet,
            knockout_winner=f.knockout_winner,
        )
        for f in fixtures
    ]


# ---------------------------------------------------------------------------
# POST /admin/simulate/fixture/{fixture_id}/result
# ---------------------------------------------------------------------------

@router.post("/fixture/{fixture_id}/result")
async def set_fixture_result(
    fixture_id: int,
    payload: SetResultRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(select(Fixture).where(Fixture.id == fixture_id))
    fixture = res.scalar_one_or_none()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    group_code = fixture.group_code
    is_group = fixture.stage == FixtureStage.group

    fixture.home_score = payload.home_score
    fixture.away_score = payload.away_score
    fixture.home_score_aet = payload.home_score_aet
    fixture.away_score_aet = payload.away_score_aet

    # Auto-derive knockout_winner from AET scores if not explicitly provided
    ko_winner = payload.knockout_winner
    if ko_winner is None and payload.home_score_aet is not None and payload.away_score_aet is not None:
        if payload.home_score_aet > payload.away_score_aet:
            ko_winner = fixture.home_team
        elif payload.away_score_aet > payload.home_score_aet:
            ko_winner = fixture.away_team
    if ko_winner is not None and ko_winner not in (fixture.home_team, fixture.away_team):
        raise HTTPException(
            status_code=400,
            detail=f"knockout_winner '{ko_winner}' must be one of the fixture's teams: '{fixture.home_team}' or '{fixture.away_team}'",
        )
    fixture.knockout_winner = ko_winner

    fixture.status = FixtureStatus.completed
    await db.commit()

    await _resolve_completed_fixture(fixture_id)

    grade_group = False
    if is_group and group_code:
        group_fixtures_res = await db.execute(
            select(Fixture).where(
                Fixture.group_code == group_code,
                Fixture.stage == FixtureStage.group,
            )
        )
        group_fixtures = group_fixtures_res.scalars().all()
        if all(f.status == FixtureStatus.completed for f in group_fixtures):
            await _resolve_group_standings(group_code)
            grade_group = True

    return {
        "fixture_id": fixture_id,
        "home_score": payload.home_score,
        "away_score": payload.away_score,
        "knockout_winner": payload.knockout_winner,
        "status": "completed",
        "grading_dispatched": True,
        "group_standings_graded": grade_group,
    }


# ---------------------------------------------------------------------------
# POST /admin/simulate/fixture/{fixture_id}/reset
# ---------------------------------------------------------------------------

@router.post("/fixture/{fixture_id}/reset")
async def reset_fixture(
    fixture_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(select(Fixture).where(Fixture.id == fixture_id))
    fixture = res.scalar_one_or_none()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    # Collect ledger rows for this fixture's match points
    ledger_match_res = await db.execute(
        select(UserPointsLedger).where(
            UserPointsLedger.source_type == PointsSourceType.match,
            UserPointsLedger.source_id == str(fixture_id),
        )
    )
    ledger_match_rows = list(ledger_match_res.scalars().all())

    # If this is a group fixture and group bracket was already graded, reverse that too
    ledger_bracket_rows: list[UserPointsLedger] = []
    if fixture.group_code and fixture.stage == FixtureStage.group:
        ledger_bracket_res = await db.execute(
            select(UserPointsLedger).where(
                UserPointsLedger.source_type == PointsSourceType.group_bracket,
                UserPointsLedger.source_id == fixture.group_code,
            )
        )
        ledger_bracket_rows = list(ledger_bracket_res.scalars().all())

    all_ledger_rows = ledger_match_rows + ledger_bracket_rows
    affected_user_ids = list({r.user_id for r in all_ledger_rows})

    for row in all_ledger_rows:
        await db.delete(row)

    # Zero out match prediction points and unlock
    preds_res = await db.execute(
        select(MatchPrediction).where(MatchPrediction.fixture_id == fixture_id)
    )
    predictions = list(preds_res.scalars().all())
    for pred in predictions:
        pred.points_awarded = 0
        pred.is_locked = False

    fixture.home_score = None
    fixture.away_score = None
    fixture.home_score_aet = None
    fixture.away_score_aet = None
    fixture.knockout_winner = None
    fixture.status = FixtureStatus.scheduled

    # Flush deletes before recomputing sums so the queries see post-delete state
    await db.flush()

    new_totals = await recompute_users_in_session(db, affected_user_ids, fixture.tournament_id)

    if fixture.group_code and fixture.stage == FixtureStage.group:
        await redis_client.delete(_GROUP_GRADED_KEY.format(group_code=fixture.group_code))

    await db.commit()

    if affected_user_ids:
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(affected_user_ids))
        )
        for membership in memberships_res.scalars().all():
            pts = new_totals.get(membership.user_id, 0)
            await update_user_score(membership.league_id, membership.user_id, pts)

    return {
        "fixture_id": fixture_id,
        "predictions_reversed": len(predictions),
        "status": "scheduled",
    }


# ---------------------------------------------------------------------------
# POST /admin/simulate/group/{group_code}/complete
# ---------------------------------------------------------------------------

@router.post("/group/{group_code}/complete")
async def complete_group(
    group_code: str,
    payload: GroupCompleteRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    res = await db.execute(
        select(Fixture).where(
            Fixture.group_code == group_code.upper(),
            Fixture.stage == FixtureStage.group,
        )
    )
    fixtures = res.scalars().all()
    if not fixtures:
        raise HTTPException(status_code=404, detail=f"No group-stage fixtures found for group {group_code}")

    score_overrides: dict[int, tuple[int, int]] = {
        s["fixture_id"]: (s["home_score"], s["away_score"])
        for s in payload.scores
        if "fixture_id" in s and "home_score" in s and "away_score" in s
    }

    completed = []
    for fixture in fixtures:
        if fixture.status == FixtureStatus.completed:
            completed.append(fixture.id)
            continue
        if fixture.id in score_overrides:
            home_score, away_score = score_overrides[fixture.id]
        else:
            home_score, away_score = _random_score()
        fixture.home_score = home_score
        fixture.away_score = away_score
        fixture.status = FixtureStatus.completed
        completed.append(fixture.id)

    await db.commit()

    for fid in completed:
        await _resolve_completed_fixture(fid)

    await _resolve_group_standings(group_code.upper())

    return {
        "group_code": group_code.upper(),
        "fixtures_completed": len(completed),
        "grading_dispatched": True,
    }


# ---------------------------------------------------------------------------
# POST /admin/simulate/stage/{stage}/advance
# Populate the NEXT stage's fixture teams from completed current-stage results.
# ---------------------------------------------------------------------------

@router.post("/stage/{stage}/advance")
async def advance_stage(
    stage: str,
    tournament_id: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Populate the next stage's fixture home/away teams based on results of the given stage.

    group       → round_32:      Use computed group standings + R32 seeding rules
    round_32    → round_16:      Pair consecutive R32 winners
    round_16    → quarter_final: Pair consecutive R16 winners
    quarter_final → semi_final:  Pair consecutive QF winners
    semi_final  → final + third: SF winners → Final, SF losers → 3rd place
    """

    # ── group → round_32 ──────────────────────────────────────────────────
    if stage == "group":
        # Verify all group fixtures are complete
        incomplete_res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage == FixtureStage.group,
                Fixture.status != FixtureStatus.completed,
            )
        )
        if incomplete_res.scalars().first():
            raise HTTPException(status_code=400, detail="Not all group-stage fixtures are completed yet.")

        # Compute standings for all groups
        group_standings = await _compute_all_group_standings(db, tournament_id)

        def get_team(group: str, pos: int) -> str:
            """Return the team at position pos (1-indexed) in group standings."""
            standings = group_standings.get(group.upper(), {})
            for team, p in standings.items():
                if p == pos:
                    return team
            return f"{group}{pos} (TBD)"

        # Get R32 fixtures ordered by kickoff time
        r32_res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage == FixtureStage.round_32,
            ).order_by(Fixture.kickoff_time)
        )
        r32_fixtures = list(r32_res.scalars().all())

        if not r32_fixtures:
            raise HTTPException(status_code=404, detail="No Round of 32 fixtures found in this tournament.")

        # Fetch all group fixtures once — used for both 3rd-place ranking and logo lookup
        fixtures_res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage == FixtureStage.group,
                Fixture.status == FixtureStatus.completed,
            )
        )
        all_group_fixtures = fixtures_res.scalars().all()

        # Build team → logo URL map from group fixtures
        team_logo_map: dict[str, str] = {}
        for f in all_group_fixtures:
            if f.home_logo:
                team_logo_map[f.home_team] = f.home_logo
            if f.away_logo:
                team_logo_map[f.away_team] = f.away_logo

        # 1. Assign the 8 Certain Seeding matchups (with logos)
        for r32_idx, g1, p1, g2, p2 in R32_CERTAIN_SEEDING:
            if r32_idx >= len(r32_fixtures):
                continue
            home = get_team(g1, p1)
            away = get_team(g2, p2)
            r32_fixtures[r32_idx].home_team = home
            r32_fixtures[r32_idx].away_team = away
            r32_fixtures[r32_idx].home_logo = team_logo_map.get(home)
            r32_fixtures[r32_idx].away_logo = team_logo_map.get(away)

        # 2. Assign the 8 Third-Place matchups
        # Collect third-place teams with their stats for ranking
        group_raw: dict[str, dict[str, dict]] = {}
        for f in all_group_fixtures:
            g = f.group_code or "?"
            if g not in group_raw:
                group_raw[g] = {}
            for team, scored, conceded in [
                (f.home_team, f.home_score, f.away_score),
                (f.away_team, f.away_score, f.home_score),
            ]:
                if team not in group_raw[g]:
                    group_raw[g][team] = {"pts": 0, "gd": 0, "gf": 0}
                if scored is None or conceded is None:
                    continue
                if scored > conceded:
                    group_raw[g][team]["pts"] += 3
                elif scored == conceded:
                    group_raw[g][team]["pts"] += 1
                group_raw[g][team]["gd"] += scored - conceded
                group_raw[g][team]["gf"] += scored

        # Assign best 8 third-place teams to their R32 slots using FIFA Annex C eligibility
        # constraints (each slot only accepts teams from its pre-defined pool of source groups).
        # Build (group_code, team_name) pairs for all 3rd-place finishers, ranked by pts/gd/gf.
        ranked_thirds_with_groups: list[tuple[str, str]] = [
            (g, team)
            for g, standings in group_standings.items()
            for team, pos in standings.items()
            if pos == 3
        ]
        # Re-rank by pts/gd/gf using raw match stats
        def _third_sort_key(gt: tuple[str, str]) -> tuple[int, int, int]:
            g, t = gt
            s = group_raw.get(g, {}).get(t, {})
            return (-s.get("pts", 0), -s.get("gd", 0), -s.get("gf", 0))
        ranked_thirds_with_groups.sort(key=_third_sort_key)
        best_8_with_groups = ranked_thirds_with_groups[:8]

        slot_assignment = _assign_third_place_teams(best_8_with_groups, R32_THIRD_PLACE_SEEDING)

        for r32_idx, winner_group, _eligible in R32_THIRD_PLACE_SEEDING:
            if r32_idx >= len(r32_fixtures):
                continue
            home = get_team(winner_group, 1)
            away = slot_assignment.get(r32_idx, f"3rd (TBD)")
            r32_fixtures[r32_idx].home_team = home
            r32_fixtures[r32_idx].away_team = away
            r32_fixtures[r32_idx].home_logo = team_logo_map.get(home)
            r32_fixtures[r32_idx].away_logo = team_logo_map.get(away)

        await db.commit()
        await redis_client.delete(f"cache:bracket:actual_results:{tournament_id}")
        return {"stage": "group", "advanced_to": "round_32", "fixtures_updated": min(len(r32_fixtures), 16)}

    # ── KO stage → next KO stage ──────────────────────────────────────────
    stage_enum_map = {
        "round_32": FixtureStage.round_32,
        "round_16": FixtureStage.round_16,
        "quarter_final": FixtureStage.quarter_final,
        "semi_final": FixtureStage.semi_final,
    }
    if stage not in stage_enum_map:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {stage}. Must be one of: group, round_32, round_16, quarter_final, semi_final")

    current_stage = stage_enum_map[stage]

    # Get completed fixtures for current stage, ordered by kickoff (preserves bracket order)
    completed_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == current_stage,
            Fixture.status == FixtureStatus.completed,
        ).order_by(Fixture.kickoff_time)
    )
    completed = list(completed_res.scalars().all())

    # Check for any incomplete fixtures
    all_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == current_stage,
        )
    )
    all_fixtures = list(all_res.scalars().all())

    if len(completed) < len(all_fixtures):
        raise HTTPException(
            status_code=400,
            detail=f"Not all {stage} fixtures are completed yet ({len(completed)}/{len(all_fixtures)})."
        )

    updated = await _advance_ko_stage(current_stage, tournament_id, db)
    await db.commit()
    next_stage_label = "final + third_place" if stage == "semi_final" else (STAGE_CHAIN.get(stage, FixtureStage.final).value)
    return {"stage": stage, "advanced_to": next_stage_label, "fixtures_updated": updated}


# ---------------------------------------------------------------------------
# POST /admin/simulate/stage/{stage}/complete
# Complete all fixtures in a KO stage with random scores
# ---------------------------------------------------------------------------

@router.post("/stage/{stage}/complete")
async def complete_ko_stage(
    stage: str,
    tournament_id: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Complete all remaining fixtures in a KO stage with random realistic scores.
    Dispatches grading for each completed fixture.
    """
    stage_map = {
        "round_32": FixtureStage.round_32,
        "round_16": FixtureStage.round_16,
        "quarter_final": FixtureStage.quarter_final,
        "semi_final": FixtureStage.semi_final,
        "third_place": FixtureStage.third_place,
        "final": FixtureStage.final,
    }
    if stage not in stage_map:
        raise HTTPException(status_code=400, detail=f"Unknown stage: {stage}")

    res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == stage_map[stage],
            Fixture.status != FixtureStatus.completed,
        ).order_by(Fixture.kickoff_time)
    )
    fixtures = list(res.scalars().all())

    if not fixtures:
        return {"stage": stage, "fixtures_completed": 0, "message": "All fixtures already completed."}

    completed_ids = []
    for fixture in fixtures:
        home_ft, away_ft, home_aet, away_aet, ko_winner = _random_ko_result(
            fixture.home_team, fixture.away_team
        )
        fixture.home_score = home_ft
        fixture.away_score = away_ft
        fixture.home_score_aet = home_aet
        fixture.away_score_aet = away_aet
        fixture.knockout_winner = ko_winner
        fixture.status = FixtureStatus.completed
        completed_ids.append(fixture.id)

    await db.commit()

    for fid in completed_ids:
        await _resolve_completed_fixture(fid)

    # Grade KO bracket picks for this stage
    await _resolve_ko_stage(tournament_id, stage_map[stage].value)

    # Auto-advance: populate next stage's team slots from the winners
    advanced = 0
    if stage not in ("final", "third_place"):
        advanced = await _advance_ko_stage(stage_map[stage], tournament_id, db)
        if advanced:
            await db.commit()

    return {
        "stage": stage,
        "fixtures_completed": len(completed_ids),
        "grading_dispatched": True,
        "next_stage_populated": advanced,
    }


# ---------------------------------------------------------------------------
# POST /admin/simulate/stage/{stage}/reset
# Reset all results for an entire stage (with later-stage guard)
# ---------------------------------------------------------------------------

@router.post("/stage/{stage}/reset")
async def reset_stage(
    stage: str,
    tournament_id: int = 1,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Reverse all results for every fixture in the given stage:
      - Points are deducted from users and leaderboards updated.
      - All fixtures in the stage return to 'scheduled'.
      - The immediately following stage's fixture team names are blanked to
        'Winner TBD' so predictions for that stage are correctly locked until
        the stage is re-populated via advance.

    Guard: blocked if any fixture in a later stage is already completed.
    """
    stage_map = {
        "group": FixtureStage.group,
        "round_32": FixtureStage.round_32,
        "round_16": FixtureStage.round_16,
        "quarter_final": FixtureStage.quarter_final,
        "semi_final": FixtureStage.semi_final,
        "third_place": FixtureStage.third_place,
        "final": FixtureStage.final,
    }
    if stage not in stage_map:
        raise HTTPException(status_code=400, detail=f"Unknown stage: {stage}")

    stage_enum = stage_map[stage]
    stage_idx = STAGE_SEQUENCE.index(stage_enum)
    later_stages = STAGE_SEQUENCE[stage_idx + 1:]

    # Guard: reject if any later stage has completed fixtures
    if later_stages:
        later_check = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage.in_(later_stages),
                Fixture.status == FixtureStatus.completed,
            ).limit(1)
        )
        if later_check.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail="Cannot reset this stage — later stage(s) have completed fixtures. Reset those stages first.",
            )

    # Fetch all fixtures in this stage
    fixtures_res = await db.execute(
        select(Fixture).where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == stage_enum,
        )
    )
    fixtures = list(fixtures_res.scalars().all())
    if not fixtures:
        raise HTTPException(status_code=404, detail=f"No fixtures found for stage: {stage}")

    completed_ids = [f.id for f in fixtures if f.status == FixtureStatus.completed]

    # Collect all ledger rows for this stage: match points + bracket points
    all_ledger_rows: list[UserPointsLedger] = []

    if completed_ids:
        ledger_match_res = await db.execute(
            select(UserPointsLedger).where(
                UserPointsLedger.source_type == PointsSourceType.match,
                UserPointsLedger.source_id.in_([str(fid) for fid in completed_ids]),
            )
        )
        all_ledger_rows.extend(ledger_match_res.scalars().all())

    if stage_enum == FixtureStage.group:
        group_codes = list({f.group_code for f in fixtures if f.group_code})
        for gc in group_codes:
            ledger_grp_res = await db.execute(
                select(UserPointsLedger).where(
                    UserPointsLedger.source_type == PointsSourceType.group_bracket,
                    UserPointsLedger.source_id == gc,
                )
            )
            all_ledger_rows.extend(ledger_grp_res.scalars().all())
    else:
        # KO stage: reverse ko_bracket ledger rows for this stage
        ko_source_ids = [
            f"{stage_enum.value}:{tournament_id}",
            f"finals:{tournament_id}",
        ]
        ledger_ko_res = await db.execute(
            select(UserPointsLedger).where(
                UserPointsLedger.source_type == PointsSourceType.ko_bracket,
                UserPointsLedger.source_id.in_(ko_source_ids),
                UserPointsLedger.tournament_id == tournament_id,
            )
        )
        all_ledger_rows.extend(ledger_ko_res.scalars().all())

    affected_user_ids = list({r.user_id for r in all_ledger_rows})

    for row in all_ledger_rows:
        await db.delete(row)

    # Zero out match predictions for completed fixtures
    predictions_reversed = 0
    if completed_ids:
        preds_res = await db.execute(
            select(MatchPrediction).where(MatchPrediction.fixture_id.in_(completed_ids))
        )
        predictions = list(preds_res.scalars().all())
        for pred in predictions:
            pred.points_awarded = 0
            pred.is_locked = False
        predictions_reversed = len(predictions)

    # Reset all fixtures to scheduled with no scores
    for f in fixtures:
        f.home_score = None
        f.away_score = None
        f.home_score_aet = None
        f.away_score_aet = None
        f.knockout_winner = None
        f.status = FixtureStatus.scheduled

    # Clear Redis grading guards
    if stage_enum == FixtureStage.group:
        group_codes = list({f.group_code for f in fixtures if f.group_code})
        for gc in group_codes:
            await redis_client.delete(_GROUP_GRADED_KEY.format(group_code=gc))
    else:
        # Clear KO bracket guard so this stage can be re-graded
        await redis_client.delete(f"grading:ko:{tournament_id}:{stage_enum.value}:graded")
        if stage_enum == FixtureStage.semi_final:
            await redis_client.delete(f"grading:ko:{tournament_id}:{FixtureStage.final.value}:graded")
            await redis_client.delete(f"grading:ko:{tournament_id}:{FixtureStage.third_place.value}:graded")

    # Blank out the next stage's team names so predictions re-lock correctly
    next_stages_to_blank: list[FixtureStage] = []
    if stage_enum == FixtureStage.semi_final:
        next_stages_to_blank = [FixtureStage.final, FixtureStage.third_place]
    elif stage_idx + 1 < len(STAGE_SEQUENCE):
        next_stages_to_blank = [STAGE_SEQUENCE[stage_idx + 1]]

    for ns in next_stages_to_blank:
        nf_res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.stage == ns,
            )
        )
        for nf in nf_res.scalars().all():
            nf.home_team = "Winner TBD"
            nf.away_team = "Winner TBD"
            nf.home_logo = None
            nf.away_logo = None

    # Flush deletes before recomputing sums so the queries see post-delete state
    await db.flush()

    new_totals = await recompute_users_in_session(db, affected_user_ids, tournament_id)

    await db.commit()

    if affected_user_ids:
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(affected_user_ids))
        )
        for membership in memberships_res.scalars().all():
            pts = new_totals.get(membership.user_id, 0)
            await update_user_score(membership.league_id, membership.user_id, pts)

    await redis_client.delete(f"cache:bracket:actual_results:{tournament_id}")

    return {
        "stage": stage,
        "fixtures_reset": len(fixtures),
        "predictions_reversed": predictions_reversed,
    }
