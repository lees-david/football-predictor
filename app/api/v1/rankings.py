from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from api.deps import get_db, get_current_user
from models.user import User
from models.match_prediction import MatchPrediction
from models.bracket_prediction import BracketPrediction
from models.historical_ranking import HistoricalRanking
from models.league_member import LeagueMember
from schemas.ranking import LeaderboardResponse, HistoricalRankResponse, LeaderboardEntry, ScoreBreakdown, GlobalRankResponse
from services.leaderboard import get_leaderboard
from models.league import League

router = APIRouter()


async def _get_score_breakdowns(
    db: AsyncSession,
    user_ids: list[int],
    league_id: int,
) -> dict[int, ScoreBreakdown]:
    """
    Compute per-user point breakdowns from MatchPredictions and BracketPredictions.
    Points in MatchPrediction.points_awarded are 5 (exact), 3 (margin), or 2 (outcome).
    """
    if not user_ids:
        return {}

    # Get league's tournament_id via a member lookup
    member_res = await db.execute(
        select(LeagueMember).where(LeagueMember.league_id == league_id).limit(1)
    )
    member = member_res.scalar_one_or_none()

    # Bulk fetch all match predictions for these users
    preds_res = await db.execute(
        select(
            MatchPrediction.user_id,
            MatchPrediction.points_awarded,
        ).where(
            MatchPrediction.user_id.in_(user_ids),
            MatchPrediction.points_awarded > 0,
        )
    )
    rows = preds_res.all()

    # Initialise breakdown per user
    breakdowns: dict[int, ScoreBreakdown] = {uid: ScoreBreakdown() for uid in user_ids}

    for user_id, pts in rows:
        bd = breakdowns[user_id]
        if pts == 5:
            bd.exact_score += 5
        elif pts == 3:
            bd.correct_margin += 3
        elif pts == 2:
            bd.correct_outcome += 2

    # Fetch bracket (group + KO) points per user
    bracket_res = await db.execute(
        select(BracketPrediction.user_id, BracketPrediction.total_points).where(
            BracketPrediction.user_id.in_(user_ids),
            BracketPrediction.total_points > 0,
        )
    )
    for user_id, bracket_pts in bracket_res.all():
        if user_id in breakdowns:
            breakdowns[user_id].bracket_pts += bracket_pts

    return breakdowns


@router.get("/global", response_model=GlobalRankResponse)
async def get_global_rank(
    tournament_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the current user's rank across all players in a tournament."""
    league_ids_res = await db.execute(
        select(League.id).where(League.tournament_id == tournament_id)
    )
    league_ids = [row[0] for row in league_ids_res.all()]
    if not league_ids:
        return GlobalRankResponse(rank=None, total_players=0)

    members_res = await db.execute(
        select(LeagueMember.user_id).where(LeagueMember.league_id.in_(league_ids)).distinct()
    )
    all_user_ids = [row[0] for row in members_res.all()]
    if not all_user_ids:
        return GlobalRankResponse(rank=None, total_players=0)

    users_res = await db.execute(
        select(User.id, User.total_points).where(User.id.in_(all_user_ids))
    )
    points_by_user = {row[0]: row[1] for row in users_res.all()}

    sorted_users = sorted(points_by_user.items(), key=lambda x: (-x[1], x[0]))
    rank = next((i + 1 for i, (uid, _) in enumerate(sorted_users) if uid == current_user.id), None)

    return GlobalRankResponse(rank=rank, total_players=len(sorted_users))


@router.get("/{league_id}", response_model=LeaderboardResponse)
async def get_league_leaderboard(
    league_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # All members of the league (source of truth — Redis misses zero-point users)
    members_res = await db.execute(
        select(LeagueMember.user_id).where(LeagueMember.league_id == league_id)
    )
    all_member_ids: set[int] = {row[0] for row in members_res.all()}

    redis_entries = await get_leaderboard(league_id)
    points_by_id: dict[int, int] = {uid: pts for uid, pts in redis_entries}

    # Include members not yet in Redis with 0 points
    for uid in all_member_ids:
        if uid not in points_by_id:
            points_by_id[uid] = 0

    # Sort: higher points first, then stable by user_id
    sorted_entries = sorted(points_by_id.items(), key=lambda x: (-x[1], x[0]))

    all_user_ids = list(points_by_id.keys())
    users_by_id: dict[int, User] = {}
    if all_user_ids:
        result = await db.execute(select(User).where(User.id.in_(all_user_ids)))
        users_by_id = {u.id: u for u in result.scalars().all()}

    breakdowns = await _get_score_breakdowns(db, all_user_ids, league_id)

    response_entries = []
    for i, (user_id, points) in enumerate(sorted_entries):
        user = users_by_id.get(user_id)
        name = user.display_name if user else f"User {user_id}"
        team = user.team_name if user else None
        response_entries.append(LeaderboardEntry(
            rank=i + 1,
            user_id=user_id,
            display_name=name,
            team_name=team,
            total_points=points,
            delta=0,
            breakdown=breakdowns.get(user_id),
        ))

    return LeaderboardResponse(league_id=league_id, entries=response_entries)


@router.get("/{league_id}/history", response_model=list[HistoricalRankResponse])
async def get_ranking_history(
    league_id: int,
    tournament_id: int | None = None,
    limit: int = Query(5000, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import joinedload
    stmt = (
        select(HistoricalRanking)
        .where(HistoricalRanking.league_id == league_id)
        .options(joinedload(HistoricalRanking.user))
        .order_by(HistoricalRanking.recorded_at)
        .limit(limit)
    )
    if tournament_id is not None:
        # Filter to the leagues for this tournament so history is tournament-scoped.
        # HistoricalRanking has no tournament_id column; filter via the League join.
        stmt = stmt.join(League, League.id == HistoricalRanking.league_id).where(
            League.tournament_id == tournament_id
        )
    results = await db.execute(stmt)
    history = []
    for rank in results.scalars().all():
        history.append(HistoricalRankResponse(
            user_id=rank.user_id,
            display_name=rank.user.display_name,
            matchday_id=rank.matchday_id,
            rank_at_time=rank.rank_at_time,
            points_at_time=rank.points_at_time,
            recorded_at=rank.recorded_at,
        ))
    return history
