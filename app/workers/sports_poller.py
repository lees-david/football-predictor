"""
sports_poller.py — Celery tasks that sync fixture results from football-data.org.

Replaces the former Wikipedia/BeautifulSoup scraper with a single call to
GET /v4/competitions/WC/matches?status=FINISHED per poll cycle.

Rate limit:  10 req/min on the free tier — one competition-wide call per poll
             cycle keeps us well within budget.
Free-tier note: scores are delayed (not real-time), so a 5-min poll interval
             is appropriate; polling faster buys nothing.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import TypedDict

from sqlalchemy import select
from core.database import AsyncSessionLocal
from core.redis_client import redis_client
from core.celery_app import celery_app
from models.fixture import Fixture, FixtureStatus, FixtureStage

logger = logging.getLogger(__name__)

MAX_CALLS_PER_DAY = 90  # retained for downstream compatibility
BUDGET_KEY = "api_football:calls:today"


class SyncStats(TypedDict):
    inserted: int
    updated: int
    skipped: int
    total: int
    api_calls_used: int


async def perform_sync() -> None:
    """Full results sync — called once per day at off-peak time."""
    logger.info("Executing daily football-data.org results sync…")
    from models.tournament import Tournament

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Tournament).where(Tournament.is_active == True))
        tournaments = res.scalars().all()

    if not tournaments:
        logger.warning("No active tournaments found; skipping daily sync.")
        return

    for tournament in tournaments:
        try:
            pre_completed_ids = await _snapshot_completed(tournament.id)
            from services.football_data import fetch_and_apply_results
            await fetch_and_apply_results(tournament_id=tournament.id)
            logger.info("Daily sync complete for tournament %d.", tournament.id)

            from datetime import datetime, timezone
            await redis_client.set(
                "admin:last_fixture_sync", datetime.now(timezone.utc).isoformat()
            )
            await _dispatch_grading(pre_completed_ids)
        except RuntimeError as exc:
            # Misconfigured key or similar — log clearly and skip
            logger.error("Cannot sync tournament %d: %s", tournament.id, exc)
        except Exception:
            logger.exception("Error during daily sync for tournament %d", tournament.id)


async def perform_sync_with_stats(
    league_id: str | None = None,
    season: str | None = None,
    tournament_id: int = 1,
) -> SyncStats:
    """Results sync triggered from the admin panel."""
    logger.info("Admin-triggered football-data.org sync for tournament %d…", tournament_id)
    try:
        pre_completed_ids = await _snapshot_completed(tournament_id)
        from services.football_data import fetch_and_apply_results
        newly_completed = await fetch_and_apply_results(tournament_id=tournament_id)
        await _dispatch_grading(pre_completed_ids)
        return SyncStats(
            inserted=0,
            updated=len(newly_completed),
            skipped=0,
            total=len(newly_completed),
            api_calls_used=1,
        )
    except RuntimeError as exc:
        logger.error("Sync aborted for tournament %d: %s", tournament_id, exc)
        return SyncStats(inserted=0, updated=0, skipped=0, total=0, api_calls_used=0)
    except Exception:
        logger.exception("Error during admin sync for tournament %d", tournament_id)
        return SyncStats(inserted=0, updated=0, skipped=0, total=0, api_calls_used=0)


async def _snapshot_completed(tournament_id: int) -> set[int]:
    """Return the set of fixture IDs currently marked completed."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Fixture.id).where(
                Fixture.tournament_id == tournament_id,
                Fixture.status == FixtureStatus.completed,
            )
        )
        return set(res.scalars().all())


async def poll_live_only() -> None:
    """
    Periodic check for newly finished matches.
    Runs every minute via Celery beat but self-guards with a Redis interval
    (default 5 min) so the API is called at most once per interval.

    The free-tier football-data.org endpoint is competition-wide, so one call
    covers all 104 WC fixtures — 1 API call per poll cycle.
    """
    logger.info("Executing football-data.org live poll…")

    # 1. Resolve the configured poll interval
    interval_minutes = 5
    async with AsyncSessionLocal() as db:
        from models.setting import Setting
        res = await db.execute(select(Setting).where(Setting.key == "live_sync_interval"))
        setting = res.scalar_one_or_none()
        if setting:
            try:
                interval_minutes = int(setting.value)
            except ValueError:
                logger.warning(
                    "Invalid live_sync_interval value: %r — using default 5 min.", setting.value
                )

    # 2. Redis interval guard — skip if called too recently
    last_run_str = await redis_client.get("live_sync:last_run")
    now_ts = int(time.time())
    if last_run_str:
        try:
            elapsed = now_ts - int(last_run_str)
            if elapsed < interval_minutes * 60:
                logger.info(
                    "Skipping poll: elapsed %d s < required %d s (%d min interval).",
                    elapsed, interval_minutes * 60, interval_minutes,
                )
                return
        except ValueError:
            pass

    # 3. Fetch and apply results for all active tournaments
    from models.tournament import Tournament

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Tournament).where(Tournament.is_active == True))
        active_tournaments = res.scalars().all()

    if not active_tournaments:
        logger.warning("No active tournaments; skipping live poll.")
        return

    any_success = False
    for tournament in active_tournaments:
        try:
            pre_completed_ids = await _snapshot_completed(tournament.id)
            from services.football_data import fetch_and_apply_results
            await fetch_and_apply_results(tournament_id=tournament.id)
            any_success = True
            logger.info("Live poll complete for tournament %d.", tournament.id)
            await _dispatch_grading(pre_completed_ids)
        except RuntimeError as exc:
            logger.error("Cannot poll tournament %d: %s", tournament.id, exc)
        except Exception:
            logger.exception("Error during live poll for tournament %d", tournament.id)

    if any_success:
        await redis_client.set("live_sync:last_run", str(now_ts))
        from datetime import datetime, timezone
        await redis_client.set(
            "admin:last_live_poll", datetime.now(timezone.utc).isoformat()
        )


async def _dispatch_grading(pre_completed_ids: set[int]) -> None:
    """
    Compare current completed fixtures against the pre-poll snapshot and dispatch
    grading Celery tasks for any that are newly completed.
    """
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Fixture).where(Fixture.status == FixtureStatus.completed)
        )
        all_completed = res.scalars().all()

    newly_completed = [f for f in all_completed if f.id not in pre_completed_ids]
    if not newly_completed:
        return

    for fixture in newly_completed:
        celery_app.send_task(
            "workers.bracket_engine.resolve_completed_fixture",
            args=[fixture.id],
        )
        logger.info("Dispatched grading for newly completed fixture %d", fixture.id)

    # Check whether any group that had a fixture just complete is now fully done
    affected_groups = {
        f.group_code
        for f in newly_completed
        if f.group_code and f.stage == FixtureStage.group
    }
    for group_code in affected_groups:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(Fixture).where(
                    Fixture.group_code == group_code,
                    Fixture.stage == FixtureStage.group,
                )
            )
            group_fixtures = res.scalars().all()

        if group_fixtures and all(f.status == FixtureStatus.completed for f in group_fixtures):
            celery_app.send_task(
                "workers.bracket_engine.resolve_group_standings",
                args=[group_code],
            )
            logger.info("Dispatched group standings grading for group %s", group_code)

    # Check whether any KO stage is now fully complete
    _KO_STAGES = {
        FixtureStage.round_32, FixtureStage.round_16,
        FixtureStage.quarter_final, FixtureStage.semi_final,
        FixtureStage.third_place, FixtureStage.final,
    }
    affected_ko = {
        (f.tournament_id, f.stage)
        for f in newly_completed
        if f.stage in _KO_STAGES
    }
    for t_id, stage in affected_ko:
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(Fixture).where(
                    Fixture.tournament_id == t_id,
                    Fixture.stage == stage,
                )
            )
            stage_fixtures = res.scalars().all()

        if stage_fixtures and all(f.status == FixtureStatus.completed for f in stage_fixtures):
            celery_app.send_task(
                "workers.bracket_engine.resolve_ko_stage",
                args=[t_id, stage.value],
            )
            logger.info(
                "Dispatched KO stage grading for tournament %d stage %s", t_id, stage.value
            )


# ── Celery tasks ──────────────────────────────────────────────────────────────

@celery_app.task
def daily_fixture_sync():
    """Full results sync — scheduled once per day at off-peak time."""
    from core.redis_client import close_redis
    async def run():
        try:
            await perform_sync()
        finally:
            await close_redis()
    asyncio.run(run())


@celery_app.task
def poll_live_fixtures():
    """Periodic check for newly finished matches (self-guarded by Redis interval)."""
    from core.redis_client import close_redis
    async def run():
        try:
            await poll_live_only()
        finally:
            await close_redis()
    asyncio.run(run())

