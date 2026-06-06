from core.redis_client import redis_client
from sqlalchemy.ext.asyncio import AsyncSession

async def update_user_score(league_id: int, user_id: int, new_total_points: int):
    """Update user's score in the league leaderboard"""
    await redis_client.zadd(f"leaderboard:{league_id}", {str(user_id): new_total_points})

async def get_user_rank(league_id: int, user_id: int) -> int | None:
    """Get 1-indexed rank of a user in a league"""
    # zrevrank returns 0-indexed rank, we want 1-indexed
    rank = await redis_client.zrevrank(f"leaderboard:{league_id}", str(user_id))
    if rank is not None:
        return rank + 1
    return None

async def get_leaderboard(league_id: int, limit: int = 100) -> list[tuple[int, int]]:
    """Get top `limit` users in a league. Returns list of (user_id, points)"""
    results = await redis_client.zrevrange(f"leaderboard:{league_id}", 0, limit - 1, withscores=True)
    return [(int(user_id), int(score)) for user_id, score in results]


async def snapshot_league_ranks(
    db: AsyncSession,
    league_ids: set[int],
    matchday_id: str,
) -> int:
    """Write a HistoricalRanking row per (user, league) for each affected league.

    Called after group/KO grading completes, so the WormChart on the leaderboard
    can render rank trajectories at meaningful milestones (one snapshot per stage,
    not per fixture). Idempotent within a (league, matchday_id) — re-runs replace
    the prior snapshot for that bucket.
    """
    from models.historical_ranking import HistoricalRanking
    from sqlalchemy import delete as sa_delete

    if not league_ids:
        return 0

    total_written = 0
    for league_id in league_ids:
        entries = await get_leaderboard(league_id, limit=1000)
        if not entries:
            continue

        # Idempotency: drop any prior rows for this (league, matchday_id)
        await db.execute(
            sa_delete(HistoricalRanking).where(
                HistoricalRanking.league_id == league_id,
                HistoricalRanking.matchday_id == matchday_id,
            )
        )

        for rank_idx, (user_id, points) in enumerate(entries):
            db.add(HistoricalRanking(
                user_id=user_id,
                league_id=league_id,
                matchday_id=matchday_id,
                points_at_time=points,
                rank_at_time=rank_idx + 1,
            ))
            total_written += 1

    await db.commit()
    return total_written
