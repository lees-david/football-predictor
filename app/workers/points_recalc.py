"""
Background reconciliation: rebuild User.total_points from user_points_ledger
and resync Redis leaderboard sorted sets.

Why this exists:
  - The ledger is the source of truth for awarded points. User.total_points is
    an aggregate kept up-to-date incrementally by grading tasks (bracket_engine,
    scoring.score_ko_stage). Admin resets, partial failures, or migrations can
    leave the aggregate drifted from the ledger.
  - Redis sorted sets (leaderboard:{league_id}) are written incrementally too;
    a wipe of Redis or a new league for an existing user can leave entries missing.

This task is idempotent — running it more often costs reads but never corrupts state.
Scheduled nightly via Celery beat; also exposed via POST /admin/points/recalculate.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.celery_app import celery_app
from core.database import AsyncSessionLocal
from models.bracket_prediction import BracketPrediction
from models.user import User
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from models.league_member import LeagueMember
from services.leaderboard import update_user_score

logger = logging.getLogger(__name__)

_BRACKET_SOURCE_TYPES = [PointsSourceType.group_bracket, PointsSourceType.ko_bracket]


async def recompute_users_in_session(
    db: AsyncSession,
    user_ids: list[int],
    tournament_id: int | None = None,
) -> dict[int, int]:
    """Recompute User.total_points and BracketPrediction.total_points from the
    ledger for the given users within an existing session.

    Call this AFTER flushing any pending ledger deletes so the sums reflect the
    post-delete state. Mutates ORM objects in-place — caller must commit.

    Returns a mapping of {user_id: new_total} for use in Redis sync.
    """
    if not user_ids:
        return {}

    # Recompute User.total_points
    sums_res = await db.execute(
        select(UserPointsLedger.user_id, func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
        .where(UserPointsLedger.user_id.in_(user_ids))
        .group_by(UserPointsLedger.user_id)
    )
    new_totals: dict[int, int] = {uid: int(total) for uid, total in sums_res.all()}

    users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
    user_map: dict[int, User] = {u.id: u for u in users_res.scalars().all()}
    for user_id, user in user_map.items():
        user.total_points = new_totals.get(user_id, 0)

    # Recompute BracketPrediction.total_points
    bp_query = select(BracketPrediction).where(BracketPrediction.user_id.in_(user_ids))
    if tournament_id is not None:
        bp_query = bp_query.where(BracketPrediction.tournament_id == tournament_id)
    brackets_res = await db.execute(bp_query)
    for bracket in brackets_res.scalars().all():
        brk_sum_res = await db.execute(
            select(func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
            .where(
                UserPointsLedger.user_id == bracket.user_id,
                UserPointsLedger.tournament_id == bracket.tournament_id,
                UserPointsLedger.source_type.in_(_BRACKET_SOURCE_TYPES),
            )
        )
        bracket.total_points = int(brk_sum_res.scalar_one() or 0)

    return {uid: user_map[uid].total_points for uid in user_ids if uid in user_map}


async def _recalculate_all() -> dict:
    """Rebuild every user's total_points and BracketPrediction.total_points from
    the ledger and resync Redis leaderboard sorted sets."""
    async with AsyncSessionLocal() as db:
        sums_res = await db.execute(
            select(UserPointsLedger.user_id, func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
            .group_by(UserPointsLedger.user_id)
        )
        ledger_totals: dict[int, int] = {uid: int(total) for uid, total in sums_res.all()}

        users_res = await db.execute(select(User))
        users = list(users_res.scalars().all())

        drift_count = 0
        for user in users:
            new_total = ledger_totals.get(user.id, 0)
            if user.total_points != new_total:
                logger.info(
                    "points_recalc: user %d drifted %d -> %d",
                    user.id, user.total_points, new_total,
                )
                user.total_points = new_total
                drift_count += 1

        # Recompute BracketPrediction.total_points for all brackets
        brackets_res = await db.execute(select(BracketPrediction))
        bracket_drift = 0
        for bracket in brackets_res.scalars().all():
            brk_sum_res = await db.execute(
                select(func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
                .where(
                    UserPointsLedger.user_id == bracket.user_id,
                    UserPointsLedger.tournament_id == bracket.tournament_id,
                    UserPointsLedger.source_type.in_(_BRACKET_SOURCE_TYPES),
                )
            )
            new_brk = int(brk_sum_res.scalar_one() or 0)
            if bracket.total_points != new_brk:
                bracket.total_points = new_brk
                bracket_drift += 1

        await db.commit()

        memberships_res = await db.execute(select(LeagueMember))
        memberships = list(memberships_res.scalars().all())
        users_by_id = {u.id: u for u in users}
        for m in memberships:
            user = users_by_id.get(m.user_id)
            if user is not None:
                await update_user_score(m.league_id, user.id, user.total_points)

        logger.info(
            "points_recalc: reconciled %d users (%d drifted), %d brackets fixed, resynced %d memberships",
            len(users), drift_count, bracket_drift, len(memberships),
        )
        return {
            "users_reconciled": len(users),
            "users_drifted": drift_count,
            "brackets_fixed": bracket_drift,
            "memberships_resynced": len(memberships),
        }


async def _recalculate_user(user_id: int) -> dict:
    """Rebuild a single user's total_points and bracket totals from the ledger and resync Redis."""
    async with AsyncSessionLocal() as db:
        total_res = await db.execute(
            select(func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
            .where(UserPointsLedger.user_id == user_id)
        )
        new_total = int(total_res.scalar_one() or 0)

        user_res = await db.execute(select(User).where(User.id == user_id))
        user = user_res.scalar_one_or_none()
        if user is None:
            logger.warning("points_recalc: user %d not found", user_id)
            return {"user_id": user_id, "found": False}

        old_total = user.total_points
        user.total_points = new_total

        brackets_res = await db.execute(
            select(BracketPrediction).where(BracketPrediction.user_id == user_id)
        )
        for bracket in brackets_res.scalars().all():
            brk_sum_res = await db.execute(
                select(func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
                .where(
                    UserPointsLedger.user_id == user_id,
                    UserPointsLedger.tournament_id == bracket.tournament_id,
                    UserPointsLedger.source_type.in_(_BRACKET_SOURCE_TYPES),
                )
            )
            bracket.total_points = int(brk_sum_res.scalar_one() or 0)

        await db.commit()

        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id == user_id)
        )
        leagues = [m.league_id for m in memberships_res.scalars().all()]
        for league_id in leagues:
            await update_user_score(league_id, user_id, new_total)

        return {
            "user_id": user_id,
            "found": True,
            "old_total": old_total,
            "new_total": new_total,
            "leagues_resynced": len(leagues),
        }


@celery_app.task(name="workers.points_recalc.recalculate_all_user_points")
def recalculate_all_user_points():
    from core.redis_client import close_redis
    async def run():
        try:
            return await _recalculate_all()
        finally:
            await close_redis()
    return asyncio.run(run())


@celery_app.task(name="workers.points_recalc.recalculate_user_points")
def recalculate_user_points(user_id: int):
    from core.redis_client import close_redis
    async def run():
        try:
            return await _recalculate_user(user_id)
        finally:
            await close_redis()
    return asyncio.run(run())

