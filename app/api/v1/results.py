"""
Results Manager endpoints — admin-only tools for manually entering / correcting
real match scores when the automated scraper fails or produces wrong data.

Endpoints:
  GET  /admin/results/fixtures                   List all fixtures (reuses simulate schema)
  POST /admin/results/fixture/{id}/result        Set or correct a result; if already completed,
                                                  auto-reverses points before re-grading
  POST /admin/results/fixture/{id}/teams         Edit home/away team names for KO fixtures;
                                                  if fixture is completed, resets and regrades
"""

from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_current_admin
from core.redis_client import redis_client
from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.match_prediction import MatchPrediction
from models.user import User
from models.league_member import LeagueMember
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from services.leaderboard import update_user_score
from workers.points_recalc import recompute_users_in_session
from workers.bracket_engine import _resolve_completed_fixture, _resolve_group_standings, _resolve_ko_stage

logger = logging.getLogger(__name__)

router = APIRouter()

_GROUP_GRADED_KEY = "grading:group:{group_code}:graded"

KO_STAGES = {
    FixtureStage.round_32,
    FixtureStage.round_16,
    FixtureStage.quarter_final,
    FixtureStage.semi_final,
    FixtureStage.third_place,
    FixtureStage.final,
}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SetResultRequest(BaseModel):
    home_score: int = Field(..., ge=0, le=20)
    away_score: int = Field(..., ge=0, le=20)
    home_score_aet: Optional[int] = Field(None, ge=0, le=20)
    away_score_aet: Optional[int] = Field(None, ge=0, le=20)
    knockout_winner: Optional[str] = None
    # "live" just persists the score without grading; "completed" triggers the full pipeline
    result_status: Literal["live", "completed"] = "completed"


class SetTeamsRequest(BaseModel):
    home_team: str = Field(..., min_length=1, max_length=80)
    away_team: str = Field(..., min_length=1, max_length=80)


class FixtureResultState(BaseModel):
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


# ---------------------------------------------------------------------------
# Internal helper: reverse all awarded points for a fixture within the
# current db session. Does NOT commit — caller handles commit + leaderboards.
# Returns (affected_user_ids, group_code_if_bracket_reversed)
# ---------------------------------------------------------------------------

async def _reverse_fixture_points(
    fixture: Fixture, db: AsyncSession
) -> tuple[list[int], str | None]:
    ledger_match_res = await db.execute(
        select(UserPointsLedger).where(
            UserPointsLedger.source_type == PointsSourceType.match,
            UserPointsLedger.source_id == str(fixture.id),
        )
    )
    ledger_match_rows = list(ledger_match_res.scalars().all())

    ledger_bracket_rows: list[UserPointsLedger] = []
    bracket_group_code: str | None = None
    if fixture.group_code and fixture.stage == FixtureStage.group:
        ledger_bracket_res = await db.execute(
            select(UserPointsLedger).where(
                UserPointsLedger.source_type == PointsSourceType.group_bracket,
                UserPointsLedger.source_id == fixture.group_code,
            )
        )
        ledger_bracket_rows = list(ledger_bracket_res.scalars().all())
        if ledger_bracket_rows:
            bracket_group_code = fixture.group_code

    all_rows = ledger_match_rows + ledger_bracket_rows
    affected_user_ids = list({r.user_id for r in all_rows})

    for row in all_rows:
        await db.delete(row)

    preds_res = await db.execute(
        select(MatchPrediction).where(MatchPrediction.fixture_id == fixture.id)
    )
    for pred in preds_res.scalars().all():
        pred.points_awarded = 0
        pred.is_locked = False

    # Clear Redis grading guards so this fixture/group can be re-graded
    if fixture.group_code and fixture.stage == FixtureStage.group:
        await redis_client.delete(_GROUP_GRADED_KEY.format(group_code=fixture.group_code))

    return affected_user_ids, bracket_group_code


# ---------------------------------------------------------------------------
# GET /admin/results/fixtures
# ---------------------------------------------------------------------------

@router.get("/fixtures", response_model=list[FixtureResultState])
async def list_result_fixtures(
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
        FixtureResultState(
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
# POST /admin/results/fixture/{fixture_id}/result
# ---------------------------------------------------------------------------

@router.post("/fixture/{fixture_id}/result")
async def set_fixture_result(
    fixture_id: int,
    payload: SetResultRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Set or correct a fixture result.

    - If the fixture was already completed, its previously awarded points are
      reversed before the new result is saved and re-graded. This prevents
      double-counting on corrections.
    - If result_status == "live", the score is persisted but grading is not
      triggered (useful for in-progress matches).
    - If result_status == "completed", the full grading pipeline runs.
    """
    res = await db.execute(select(Fixture).where(Fixture.id == fixture_id))
    fixture = res.scalar_one_or_none()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    was_completed = fixture.status == FixtureStatus.completed
    affected_user_ids: list[int] = []

    # Reverse existing points if correcting a completed fixture
    if was_completed:
        affected_user_ids, _ = await _reverse_fixture_points(fixture, db)
        await db.flush()

    # Apply new score
    fixture.home_score = payload.home_score
    fixture.away_score = payload.away_score
    fixture.home_score_aet = payload.home_score_aet
    fixture.away_score_aet = payload.away_score_aet

    ko_winner = payload.knockout_winner
    if ko_winner is None and payload.home_score_aet is not None and payload.away_score_aet is not None:
        if payload.home_score_aet > payload.away_score_aet:
            ko_winner = fixture.home_team
        elif payload.away_score_aet > payload.home_score_aet:
            ko_winner = fixture.away_team
    fixture.knockout_winner = ko_winner

    if payload.result_status == "completed":
        fixture.status = FixtureStatus.completed
    else:
        fixture.status = FixtureStatus.live

    await db.commit()

    # Recompute and sync leaderboards if we reversed points
    if was_completed and affected_user_ids:
        new_totals = await recompute_users_in_session(db, affected_user_ids, fixture.tournament_id)
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(affected_user_ids))
        )
        for m in memberships_res.scalars().all():
            pts = new_totals.get(m.user_id, 0)
            await update_user_score(m.league_id, m.user_id, pts)

    grading_dispatched = False
    group_graded = False

    if payload.result_status == "completed":
        await _resolve_completed_fixture(fixture_id)
        grading_dispatched = True

        if fixture.stage == FixtureStage.group and fixture.group_code:
            group_fixtures_res = await db.execute(
                select(Fixture).where(
                    Fixture.group_code == fixture.group_code,
                    Fixture.stage == FixtureStage.group,
                )
            )
            if all(f.status == FixtureStatus.completed for f in group_fixtures_res.scalars().all()):
                await _resolve_group_standings(fixture.group_code)
                group_graded = True

        # Grade KO bracket picks if this is a KO fixture
        if fixture.stage in KO_STAGES:
            await _resolve_ko_stage(fixture.tournament_id, fixture.stage.value)

    return {
        "fixture_id": fixture_id,
        "status": fixture.status.value,
        "was_correction": was_completed,
        "grading_dispatched": grading_dispatched,
        "group_standings_graded": group_graded,
    }


# ---------------------------------------------------------------------------
# POST /admin/results/fixture/{fixture_id}/teams
# ---------------------------------------------------------------------------

@router.post("/fixture/{fixture_id}/teams")
async def set_fixture_teams(
    fixture_id: int,
    payload: SetTeamsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """
    Update the home/away team names for a KO fixture.

    If the fixture is already completed, points are reversed, teams are updated,
    and grading is re-dispatched with the corrected team names. This handles the
    case where the scraper populated the wrong team for a KO slot.
    """
    res = await db.execute(select(Fixture).where(Fixture.id == fixture_id))
    fixture = res.scalar_one_or_none()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")

    if fixture.stage == FixtureStage.group:
        raise HTTPException(status_code=400, detail="Team names are fixed for group-stage fixtures.")

    was_completed = fixture.status == FixtureStatus.completed
    affected_user_ids: list[int] = []

    if was_completed:
        affected_user_ids, _ = await _reverse_fixture_points(fixture, db)
        fixture.status = FixtureStatus.scheduled
        await db.flush()

    # Carry over logo from existing fixture data if team name unchanged
    if payload.home_team != fixture.home_team:
        fixture.home_logo = None
    if payload.away_team != fixture.away_team:
        fixture.away_logo = None

    fixture.home_team = payload.home_team
    fixture.away_team = payload.away_team

    if was_completed:
        fixture.status = FixtureStatus.completed

    await db.commit()

    if was_completed and affected_user_ids:
        new_totals = await recompute_users_in_session(db, affected_user_ids, fixture.tournament_id)
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(affected_user_ids))
        )
        for m in memberships_res.scalars().all():
            pts = new_totals.get(m.user_id, 0)
            await update_user_score(m.league_id, m.user_id, pts)

    regraded = False
    if was_completed:
        await _resolve_completed_fixture(fixture_id)
        await _resolve_ko_stage(fixture.tournament_id, fixture.stage.value)
        regraded = True

    return {
        "fixture_id": fixture_id,
        "home_team": fixture.home_team,
        "away_team": fixture.away_team,
        "was_correction": was_completed,
        "regraded": regraded,
    }
