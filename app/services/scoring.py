"""
"Any Path" KO bracket scoring engine.

Points are awarded based on set intersection of predicted vs actual teams
at each KO milestone — bracket slot position doesn't matter.
"""
from __future__ import annotations

import logging
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.bracket_prediction import BracketPrediction
from models.bracket_ko_pick import BracketKoPick, KoRound
from models.user import User
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from models.league_member import LeagueMember
from services.leaderboard import update_user_score, snapshot_league_ranks

logger = logging.getLogger(__name__)

ROUND_POINTS: dict[KoRound, int] = {
    KoRound.round_32: 3,
    KoRound.round_16: 5,
    KoRound.quarter_final: 8,
    KoRound.semi_final: 12,
}

STAGE_TO_KO_ROUND: dict[FixtureStage, KoRound] = {
    FixtureStage.round_32: KoRound.round_32,
    FixtureStage.round_16: KoRound.round_16,
    FixtureStage.quarter_final: KoRound.quarter_final,
    FixtureStage.semi_final: KoRound.semi_final,
}


def _fixture_winner(f: Fixture) -> str | None:
    if f.knockout_winner:
        return f.knockout_winner
    if f.home_score is None or f.away_score is None:
        return None
    if f.home_score > f.away_score:
        return f.home_team
    if f.away_score > f.home_score:
        return f.away_team
    return None


def _get_actual_teams_at_round(fixtures: list[Fixture], stage: FixtureStage) -> set[str]:
    """Teams that appeared in fixtures at this stage (i.e. reached this round)."""
    teams = set()
    for f in fixtures:
        if f.stage == stage and f.status == FixtureStatus.completed:
            teams.add(f.home_team)
            teams.add(f.away_team)
    return teams



def grade_ko_round(
    predicted_teams: set[str],
    actual_teams: set[str],
    ko_round: KoRound,
) -> tuple[int, set[str]]:
    """Score a single KO round using "Any Path" set intersection.
    Returns (points, matched_teams).
    """
    matched = predicted_teams & actual_teams
    pts_per_team = ROUND_POINTS.get(ko_round, 0)
    return len(matched) * pts_per_team, matched


def grade_finals_weekend(
    ko_picks: list[BracketKoPick],
    fixtures: list[Fixture],
) -> int:
    """Score the finals weekend: Perfect Pick, Inverse Pick, 3rd place.

    Data model: BracketBuilder writes one KoRound.final row (predicted champion,
    i.e. winner of the FINAL slot) and two KoRound.semi_final_final rows (predicted
    SF winners = predicted finalists). KoRound.champion is defined in the enum
    but is never written — don't read from it.
    """
    champion_pick: str | None = None
    predicted_finalists: set[str] = set()
    third_place_pick: str | None = None

    for pick in ko_picks:
        if pick.round == KoRound.final:
            champion_pick = pick.predicted_team
        elif pick.round == KoRound.semi_final:
            predicted_finalists.add(pick.predicted_team)
        elif pick.round == KoRound.third_place:
            third_place_pick = pick.predicted_team

    final_fixture = None
    third_fixture = None
    for f in fixtures:
        if f.stage == FixtureStage.final and f.status == FixtureStatus.completed:
            final_fixture = f
        elif f.stage == FixtureStage.third_place and f.status == FixtureStatus.completed:
            third_fixture = f

    pts = 0

    if final_fixture and champion_pick:
        actual_champion = _fixture_winner(final_fixture)
        actual_finalists = {final_fixture.home_team, final_fixture.away_team}
        actual_runner_up = (actual_finalists - {actual_champion}).pop() if actual_champion else None
        predicted_runner_up = (predicted_finalists - {champion_pick}).pop() if len(predicted_finalists - {champion_pick}) == 1 else None

        if champion_pick == actual_champion and predicted_runner_up == actual_runner_up:
            # Perfect Pick: champion + runner-up both correct
            pts += 20
        elif champion_pick == actual_runner_up and predicted_runner_up == actual_champion:
            # Inverse Pick: both finalists identified, winner/runner-up swapped
            pts += 10

    if third_fixture and third_place_pick:
        actual_third = _fixture_winner(third_fixture)
        if third_place_pick == actual_third:
            pts += 8

    return pts


async def score_ko_stage(
    db: AsyncSession,
    tournament_id: int,
    completed_stage: FixtureStage,
) -> None:
    """Grade all users' KO bracket picks for a completed stage.

    Called when all fixtures of a KO stage are completed.
    Uses "Any Path" scoring: set intersection of predicted vs actual teams.
    """
    from core.redis_client import redis_client

    guard_key = f"grading:ko:{tournament_id}:{completed_stage.value}:graded"
    if await redis_client.get(guard_key):
        logger.info("score_ko_stage: %s already graded for tournament %d", completed_stage.value, tournament_id)
        return

    all_fixtures_res = await db.execute(
        select(Fixture).where(Fixture.tournament_id == tournament_id)
    )
    all_fixtures = all_fixtures_res.scalars().all()

    stage_fixtures = [f for f in all_fixtures if f.stage == completed_stage]
    if not stage_fixtures or any(f.status != FixtureStatus.completed for f in stage_fixtures):
        logger.info("score_ko_stage: stage %s not fully completed", completed_stage.value)
        return

    is_finals = completed_stage in (FixtureStage.final, FixtureStage.third_place)

    brackets_res = await db.execute(
        select(BracketPrediction).where(BracketPrediction.tournament_id == tournament_id)
    )
    brackets = brackets_res.scalars().all()
    if not brackets:
        await redis_client.set(guard_key, "1")
        return

    bracket_ids = [b.id for b in brackets]
    brackets_by_id = {b.id: b for b in brackets}

    picks_res = await db.execute(
        select(BracketKoPick).where(BracketKoPick.bracket_id.in_(bracket_ids))
    )
    all_ko_picks = picks_res.scalars().all()

    picks_by_bracket: dict[int, list[BracketKoPick]] = {}
    for pick in all_ko_picks:
        picks_by_bracket.setdefault(pick.bracket_id, []).append(pick)

    user_ids = list({b.user_id for b in brackets})
    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    users_by_id = {u.id: u for u in users_res.scalars().all()}

    users_with_new_points: set[int] = set()
    for bracket_id, bracket_picks in picks_by_bracket.items():
        bracket = brackets_by_id.get(bracket_id)
        if not bracket:
            continue
        user = users_by_id.get(bracket.user_id)
        if not user:
            continue

        pts = 0

        if is_finals:
            pts = grade_finals_weekend(bracket_picks, all_fixtures)
            source_id = f"finals:{tournament_id}"
        else:
            ko_round = STAGE_TO_KO_ROUND.get(completed_stage)
            if not ko_round:
                continue

            predicted_teams = {
                p.predicted_team for p in bracket_picks if p.round == ko_round
            }

            actual_teams = _get_actual_teams_at_round(all_fixtures, completed_stage)

            pts, _ = grade_ko_round(predicted_teams, actual_teams, ko_round)

            source_id = f"{completed_stage.value}:{tournament_id}"

        if pts:
            bracket.total_points = (bracket.total_points or 0) + pts
            users_with_new_points.add(user.id)
            db.add(UserPointsLedger(
                user_id=user.id,
                tournament_id=tournament_id,
                points_awarded=pts,
                source_type=PointsSourceType.ko_bracket,
                source_id=source_id,
            ))

    # Recompute user.total_points from ledger sum (safe against concurrent writes / stale reads).
    # Flush first so the new ledger entries are visible to the SUM query within this transaction.
    if users_with_new_points:
        await db.flush()
        for user_id in users_with_new_points:
            sum_res = await db.execute(
                select(func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
                .where(UserPointsLedger.user_id == user_id)
            )
            user = users_by_id.get(user_id)
            if user:
                user.total_points = int(sum_res.scalar_one() or 0)

    # Capture totals before commit — post-commit ORM expiry can return stale values on reload
    user_new_totals = {uid: users_by_id[uid].total_points for uid in users_with_new_points if uid in users_by_id}

    await db.commit()
    await redis_client.set(guard_key, "1")

    memberships_res = await db.execute(
        select(LeagueMember).where(LeagueMember.user_id.in_(user_ids))
    )
    all_league_ids: set[int] = set()
    for membership in memberships_res.scalars().all():
        all_league_ids.add(membership.league_id)
        pts = user_new_totals.get(membership.user_id)
        if pts is not None:
            await update_user_score(membership.league_id, membership.user_id, pts)

    _KO_LABEL: dict[FixtureStage, str] = {
        FixtureStage.round_32:      "R32",
        FixtureStage.round_16:      "R16",
        FixtureStage.quarter_final: "QF",
        FixtureStage.semi_final:    "SF",
        FixtureStage.third_place:   "3rd",
        FixtureStage.final:         "F",
    }
    snapshot_label = _KO_LABEL.get(completed_stage, completed_stage.value)
    await snapshot_league_ranks(db, all_league_ids, snapshot_label)

    logger.info(
        "score_ko_stage: graded %s for tournament %d — %d brackets scored",
        completed_stage.value,
        tournament_id,
        len(picks_by_bracket),
    )
