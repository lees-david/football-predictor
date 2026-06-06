from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select, func

from core.celery_app import celery_app
from core.database import AsyncSessionLocal
from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.match_prediction import MatchPrediction
from models.bracket_prediction import BracketPrediction
from models.bracket_group_pick import BracketGroupPick
from models.league_member import LeagueMember
from models.tournament import Tournament
from models.user import User
from models.user_points_ledger import UserPointsLedger, PointsSourceType
from services.points_engine import grade_match_prediction, grade_group_bracket
from services.leaderboard import update_user_score, snapshot_league_ranks
from services.group_tiebreakers import rank_teams_in_group
from services.scoring import score_ko_stage

logger = logging.getLogger(__name__)

# Redis key used to prevent double-grading a group (idempotency guard)
_GROUP_GRADED_KEY = "grading:group:{group_code}:graded"
# Redis key to prevent duplicate round-summary emails
_ROUND_SUMMARY_SENT_KEY = "email:round_summary:{tournament_id}:{stage}:{matchday}"

_KO_STAGE_LABELS: dict[str, str] = {
    FixtureStage.round_32.value:      "Round of 32",
    FixtureStage.round_16.value:      "Round of 16",
    FixtureStage.quarter_final.value: "Quarter-Finals",
    FixtureStage.semi_final.value:    "Semi-Finals",
    FixtureStage.third_place.value:   "Third-Place Play-Off",
    FixtureStage.final.value:         "Final",
}


async def _resolve_completed_fixture(fixture_id: int) -> None:
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Fixture).where(Fixture.id == fixture_id))
        fixture = res.scalar_one_or_none()
        if fixture is None or fixture.status != FixtureStatus.completed:
            logger.warning("resolve_completed_fixture: fixture %d not found or not completed", fixture_id)
            return
        if fixture.home_score is None or fixture.away_score is None:
            logger.warning("resolve_completed_fixture: fixture %d missing score", fixture_id)
            return

        preds_res = await db.execute(
            select(MatchPrediction).where(MatchPrediction.fixture_id == fixture_id)
        )
        predictions = preds_res.scalars().all()
        if not predictions:
            logger.info("resolve_completed_fixture: no predictions for fixture %d", fixture_id)
            return

        user_ids = list({p.user_id for p in predictions})
        users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id: dict[int, User] = {u.id: u for u in users_res.scalars().all()}

        # Derive knockout_winner_sign from fixture.knockout_winner for AET/pens results
        ko_winner_sign: int | None = None
        if fixture.knockout_winner:
            if fixture.knockout_winner == fixture.home_team:
                ko_winner_sign = 1
            elif fixture.knockout_winner == fixture.away_team:
                ko_winner_sign = -1

        users_with_new_points: set[int] = set()
        for pred in predictions:
            pts = grade_match_prediction(
                pred.predicted_home,
                pred.predicted_away,
                fixture.home_score,
                fixture.away_score,
                fixture.stage,
                knockout_winner_sign=ko_winner_sign,
            )
            delta = pts - pred.points_awarded
            pred.points_awarded = pts
            pred.is_locked = True
            if delta and pred.user_id in users_by_id:
                users_with_new_points.add(pred.user_id)
                db.add(UserPointsLedger(
                    user_id=pred.user_id,
                    tournament_id=fixture.tournament_id,
                    points_awarded=delta,
                    source_type=PointsSourceType.match,
                    source_id=str(fixture_id),
                ))

        # Recompute user.total_points from ledger — one GROUP BY instead of N round-trips
        if users_with_new_points:
            await db.flush()
            sums_res = await db.execute(
                select(UserPointsLedger.user_id, func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
                .where(UserPointsLedger.user_id.in_(users_with_new_points))
                .group_by(UserPointsLedger.user_id)
            )
            for uid, new_total in sums_res.all():
                user = users_by_id.get(uid)
                if user:
                    user.total_points = int(new_total)

        # Capture totals before commit — post-commit ORM expiry can return stale values on reload
        user_new_totals = {uid: users_by_id[uid].total_points for uid in users_with_new_points if uid in users_by_id}

        await db.commit()

        # Update Redis leaderboards for all affected users across their leagues
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(user_ids))
        )
        for membership in memberships_res.scalars().all():
            pts = user_new_totals.get(membership.user_id)
            if pts is not None:
                await update_user_score(membership.league_id, membership.user_id, pts)

        # Snapshot rank history when a group-stage matchday completes across all groups.
        # For the final group matchday we skip the snapshot here — group bracket picks are
        # graded by resolve_group_standings (dispatched separately after each group
        # completes), so snapshotting now would capture pre-bracket totals.  The last
        # resolve_group_standings call takes the definitive MD-<n> snapshot instead.
        if fixture.stage == FixtureStage.group and fixture.matchday:
            all_done_res = await db.execute(
                select(func.count()).select_from(Fixture).where(
                    Fixture.tournament_id == fixture.tournament_id,
                    Fixture.stage == FixtureStage.group,
                    Fixture.matchday == fixture.matchday,
                    Fixture.status != FixtureStatus.completed,
                )
            )
            remaining = all_done_res.scalar_one()
            if remaining == 0:
                # Check whether any group matches remain at all — if so this is not
                # the final matchday and it's safe to snapshot (no bracket points yet).
                all_group_remaining_res = await db.execute(
                    select(func.count()).select_from(Fixture).where(
                        Fixture.tournament_id == fixture.tournament_id,
                        Fixture.stage == FixtureStage.group,
                        Fixture.status != FixtureStatus.completed,
                    )
                )
                all_group_remaining = all_group_remaining_res.scalar_one()
                is_final_group_matchday = all_group_remaining == 0
                if not is_final_group_matchday:
                    from models.league import League
                    league_ids_res = await db.execute(
                        select(League.id).where(League.tournament_id == fixture.tournament_id)
                    )
                    all_league_ids = set(league_ids_res.scalars().all())
                    await snapshot_league_ranks(db, all_league_ids, f"MD-{fixture.matchday}")
                send_round_summary.delay(
                    fixture.tournament_id,
                    FixtureStage.group.value,
                    fixture.matchday,
                )

        # Bust the actual-results cache so the next poll returns fresh data
        from core.redis_client import redis_client as _redis
        await _redis.delete(f"cache:bracket:actual_results:{fixture.tournament_id}")

        logger.info(
            "resolve_completed_fixture: graded %d predictions for fixture %d",
            len(predictions),
            fixture_id,
        )


async def _resolve_group_standings(group_code: str) -> None:
    from core.redis_client import redis_client

    # Idempotency guard — skip if this group has already been graded
    guard_key = _GROUP_GRADED_KEY.format(group_code=group_code)
    already_graded = await redis_client.get(guard_key)
    if already_graded:
        logger.info("resolve_group_standings: group %s already graded, skipping", group_code)
        return

    async with AsyncSessionLocal() as db:
        fixtures_res = await db.execute(
            select(Fixture).where(
                Fixture.group_code == group_code,
                Fixture.stage == FixtureStage.group,
            )
        )
        fixtures = fixtures_res.scalars().all()
        if not fixtures:
            logger.warning("resolve_group_standings: no fixtures for group %s", group_code)
            return

        if any(f.status != FixtureStatus.completed for f in fixtures):
            logger.info("resolve_group_standings: group %s not fully completed yet", group_code)
            return

        tournament_id = fixtures[0].tournament_id

        tourn_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
        tournament = tourn_res.scalar_one_or_none()
        season = tournament.api_season if tournament else None

        # Calculate actual standings: overall pts/GD/GF first, then full FIFA tiebreaker chain
        team_stats: dict[str, dict] = {}
        for f in fixtures:
            for team, scored, conceded in [
                (f.home_team, f.home_score, f.away_score),
                (f.away_team, f.away_score, f.home_score),
            ]:
                if team not in team_stats:
                    team_stats[team] = {"pts": 0, "gd": 0, "gf": 0}
                if scored is None or conceded is None:
                    continue
                if scored > conceded:
                    team_stats[team]["pts"] += 3
                elif scored == conceded:
                    team_stats[team]["pts"] += 1
                team_stats[team]["gd"] += scored - conceded
                team_stats[team]["gf"] += scored

        sorted_teams = rank_teams_in_group(team_stats, fixtures, group_code, season)
        # actual_standings: {team_name: final_position (1-indexed)}
        actual_standings: dict[str, int] = {team: pos + 1 for pos, team in enumerate(sorted_teams)}

        # Find all bracket predictions for this tournament that have picks in this group
        brackets_res = await db.execute(
            select(BracketPrediction).where(BracketPrediction.tournament_id == tournament_id)
        )
        brackets = brackets_res.scalars().all()
        if not brackets:
            return

        bracket_ids = [b.id for b in brackets]
        brackets_by_id: dict[int, BracketPrediction] = {b.id: b for b in brackets}

        picks_res = await db.execute(
            select(BracketGroupPick).where(
                BracketGroupPick.bracket_id.in_(bracket_ids),
                BracketGroupPick.group_code == group_code,
            )
        )
        picks = picks_res.scalars().all()
        if not picks:
            logger.info("resolve_group_standings: no bracket picks for group %s", group_code)
            # Still set the guard so we don't retry on every poll
            await redis_client.set(guard_key, "1")
            return

        # Group picks by bracket
        picks_by_bracket: dict[int, list[BracketGroupPick]] = {}
        for pick in picks:
            picks_by_bracket.setdefault(pick.bracket_id, []).append(pick)

        user_ids = list({brackets_by_id[bid].user_id for bid in picks_by_bracket})
        users_res = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id: dict[int, User] = {u.id: u for u in users_res.scalars().all()}

        users_with_new_points: set[int] = set()
        for bracket_id, bracket_picks in picks_by_bracket.items():
            bracket = brackets_by_id[bracket_id]
            user_group_picks: dict[str, int] = {p.predicted_team: p.position for p in bracket_picks}
            pts = grade_group_bracket(user_group_picks, actual_standings)
            bracket.total_points = (bracket.total_points or 0) + pts
            user = users_by_id.get(bracket.user_id)
            if user and pts:
                users_with_new_points.add(user.id)
                db.add(UserPointsLedger(
                    user_id=user.id,
                    tournament_id=tournament_id,
                    points_awarded=pts,
                    source_type=PointsSourceType.group_bracket,
                    source_id=group_code,
                ))

        # Recompute user.total_points from ledger — one GROUP BY instead of N round-trips.
        # Flush first so the new ledger entries are visible within this transaction.
        if users_with_new_points:
            await db.flush()
            sums_res = await db.execute(
                select(UserPointsLedger.user_id, func.coalesce(func.sum(UserPointsLedger.points_awarded), 0))
                .where(UserPointsLedger.user_id.in_(users_with_new_points))
                .group_by(UserPointsLedger.user_id)
            )
            for uid, new_total in sums_res.all():
                user = users_by_id.get(uid)
                if user:
                    user.total_points = int(new_total)

        # Capture totals before commit — post-commit ORM expiry can return stale values on reload
        user_new_totals = {uid: users_by_id[uid].total_points for uid in users_with_new_points if uid in users_by_id}

        await db.commit()

        # Mark as graded in Redis to prevent double-awarding
        await redis_client.set(guard_key, "1")

        # Update Redis leaderboards
        memberships_res = await db.execute(
            select(LeagueMember).where(LeagueMember.user_id.in_(user_ids))
        )
        affected_league_ids: set[int] = set()
        for membership in memberships_res.scalars().all():
            pts = user_new_totals.get(membership.user_id)
            if pts is not None:
                await update_user_score(membership.league_id, membership.user_id, pts)
                affected_league_ids.add(membership.league_id)

        # Bust the actual-results cache — group standings changed
        from core.redis_client import redis_client as _redis2
        await _redis2.delete(f"cache:bracket:actual_results:{tournament_id}")

        logger.info(
            "resolve_group_standings: graded group %s — standings=%s, picks=%d",
            group_code,
            actual_standings,
            len(picks),
        )

        # After grading this group, check whether all groups in the tournament are now
        # graded.  If so, take the definitive MD-3 snapshot (all match predictions +
        # all group bracket picks are in Redis at this point).
        async with AsyncSessionLocal() as snap_db:
            group_codes_res = await snap_db.execute(
                select(Fixture.group_code).where(
                    Fixture.tournament_id == tournament_id,
                    Fixture.stage == FixtureStage.group,
                    Fixture.group_code.isnot(None),
                ).distinct()
            )
            all_group_codes = [r[0] for r in group_codes_res.all()]

        all_graded = False
        if all_group_codes:
            guard_values = await redis_client.mget(
                *[_GROUP_GRADED_KEY.format(group_code=gc) for gc in all_group_codes]
            )
            all_graded = all(v is not None for v in guard_values)

        if all_graded and all_group_codes:
            # Determine the last group matchday to label the snapshot correctly
            async with AsyncSessionLocal() as snap_db:
                max_md_res = await snap_db.execute(
                    select(func.max(Fixture.matchday)).where(
                        Fixture.tournament_id == tournament_id,
                        Fixture.stage == FixtureStage.group,
                    )
                )
                last_matchday = max_md_res.scalar_one() or 3
                from models.league import League
                league_ids_res = await snap_db.execute(
                    select(League.id).where(League.tournament_id == tournament_id)
                )
                all_league_ids = set(league_ids_res.scalars().all())
                await snapshot_league_ranks(snap_db, all_league_ids, f"MD-{last_matchday}")
            logger.info(
                "resolve_group_standings: all groups graded — snapshotted MD-%s for tournament %d",
                last_matchday,
                tournament_id,
            )


async def _resolve_ko_stage(tournament_id: int, stage_value: str) -> None:
    """Grade all users' KO bracket picks for a completed KO stage.

    Wraps services.scoring.score_ko_stage with a fresh DB session, so it can
    run as a standalone Celery task. The service-layer function is also called
    directly by simulation code paths.
    """
    try:
        stage_enum = FixtureStage(stage_value)
    except ValueError:
        logger.warning("resolve_ko_stage: unknown stage %s", stage_value)
        return
    async with AsyncSessionLocal() as db:
        await score_ko_stage(db, tournament_id, stage_enum)
    send_round_summary.delay(tournament_id, stage_value, None)


async def _send_round_summary_async(
    tournament_id: int,
    stage_value: str,
    matchday: int | None,
) -> None:
    from collections import defaultdict
    from core.redis_client import redis_client
    from models.email_template import EmailType
    from models.historical_ranking import HistoricalRanking
    from models.league import League
    from models.league_member import LeagueMember
    from models.match_prediction import MatchPrediction
    from models.user_email_preference import UserEmailPreference
    from services import email_service
    from services.leaderboard import get_user_rank

    guard_key = _ROUND_SUMMARY_SENT_KEY.format(
        tournament_id=tournament_id,
        stage=stage_value,
        matchday=matchday if matchday is not None else "ko",
    )
    if await redis_client.get(guard_key):
        logger.info("send_round_summary: already sent for %s/%s/%s, skipping", tournament_id, stage_value, matchday)
        return

    _KO_SNAPSHOT_LABEL: dict[str, str] = {
        FixtureStage.round_32.value:      "R32",
        FixtureStage.round_16.value:      "R16",
        FixtureStage.quarter_final.value: "QF",
        FixtureStage.semi_final.value:    "SF",
        FixtureStage.third_place.value:   "3rd",
        FixtureStage.final.value:         "F",
    }

    if matchday is not None:
        round_name = f"Group Stage – Matchday {matchday}"
        current_snapshot_label = f"MD-{matchday}"
        stage_filter: Any = (Fixture.stage == FixtureStage.group, Fixture.matchday == matchday)
    else:
        round_name = _KO_STAGE_LABELS.get(stage_value, stage_value.replace("_", " ").title())
        current_snapshot_label = _KO_SNAPSHOT_LABEL.get(stage_value, stage_value)
        stage_filter = (Fixture.stage == FixtureStage(stage_value),)

    async with AsyncSessionLocal() as db:
        tourn_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
        tournament = tourn_res.scalar_one_or_none()
        if tournament is None:
            return

        # Completed fixtures for this boundary
        fixtures_res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.status == FixtureStatus.completed,
                *stage_filter,
            )
        )
        round_fixtures = fixtures_res.scalars().all()
        if not round_fixtures:
            logger.info("send_round_summary: no completed fixtures for %s/%s/%s", tournament_id, stage_value, matchday)
            return

        # Next upcoming fixture for the lock-deadline hint
        upcoming_res = await db.execute(
            select(Fixture)
            .where(
                Fixture.tournament_id == tournament_id,
                Fixture.status == FixtureStatus.scheduled,
            )
            .order_by(Fixture.kickoff_time.asc())
            .limit(5)
        )
        upcoming_fixtures = upcoming_res.scalars().all()

        next_round_name: str | None = None
        next_round_lock_time: str | None = None
        if upcoming_fixtures:
            nf = upcoming_fixtures[0]
            if nf.stage == FixtureStage.group and nf.matchday:
                next_round_name = f"Group Stage – Matchday {nf.matchday}"
            else:
                next_round_name = _KO_STAGE_LABELS.get(nf.stage.value, nf.stage.value)
            if nf.kickoff_time:
                next_round_lock_time = nf.kickoff_time.strftime("%-d %b %Y %H:%M UTC")

        # Site URL from settings table or fallback
        from services.email_service import get_site_url
        site_url = await get_site_url(db)

        # Qualifying users: active + in an emails-enabled league + opted-in for round_summary
        users_res = await db.execute(
            select(User)
            .join(LeagueMember, LeagueMember.user_id == User.id)
            .join(League, LeagueMember.league_id == League.id)
            .join(
                UserEmailPreference,
                (UserEmailPreference.user_id == User.id)
                & (UserEmailPreference.email_type == EmailType.round_summary),
            )
            .where(
                League.tournament_id == tournament_id,
                League.emails_enabled == True,
                User.is_active == True,
                UserEmailPreference.opted_in == True,
            )
            .distinct()
        )
        qualifying_users = users_res.scalars().all()
        logger.info(
            "send_round_summary: tournament=%s round=%s users=%d",
            tournament_id, round_name, len(qualifying_users),
        )

        if not qualifying_users:
            await redis_client.set(guard_key, "1")
            return

        user_ids = [u.id for u in qualifying_users]
        fixture_ids = [f.id for f in round_fixtures]

        # Batch-fetch predictions for all qualifying users across all round fixtures
        preds_res = await db.execute(
            select(MatchPrediction).where(
                MatchPrediction.fixture_id.in_(fixture_ids),
                MatchPrediction.user_id.in_(user_ids),
            )
        )
        preds_by_user_fixture: dict[tuple[int, int], MatchPrediction] = {
            (p.user_id, p.fixture_id): p
            for p in preds_res.scalars().all()
        }

        # Batch-fetch league memberships for qualifying users in this tournament
        memberships_res = await db.execute(
            select(LeagueMember, League)
            .join(League, LeagueMember.league_id == League.id)
            .where(
                LeagueMember.user_id.in_(user_ids),
                League.tournament_id == tournament_id,
                League.emails_enabled == True,
            )
        )
        memberships_by_user: dict[int, list[tuple[LeagueMember, League]]] = defaultdict(list)
        for member, league in memberships_res.all():
            memberships_by_user[member.user_id].append((member, league))

        # Batch-fetch the most recent previous snapshot per (user, league) for rank movement
        prev_ranks_res = await db.execute(
            select(
                HistoricalRanking.user_id,
                HistoricalRanking.league_id,
                HistoricalRanking.rank_at_time,
            )
            .where(
                HistoricalRanking.user_id.in_(user_ids),
                HistoricalRanking.matchday_id != current_snapshot_label,
            )
            .order_by(
                HistoricalRanking.user_id,
                HistoricalRanking.league_id,
                HistoricalRanking.recorded_at.desc(),
            )
            .distinct(HistoricalRanking.user_id, HistoricalRanking.league_id)
        )
        prev_rank_by_user_league: dict[tuple[int, int], int] = {
            (row.user_id, row.league_id): row.rank_at_time
            for row in prev_ranks_res.all()
        }

        for user in qualifying_users:
            # Build per-user match rows with their predictions and points
            user_match_rows = []
            for f in round_fixtures:
                pred = preds_by_user_fixture.get((user.id, f.id))
                user_match_rows.append({
                    "home_team": f.home_team,
                    "away_team": f.away_team,
                    "home_score": f.home_score,
                    "away_score": f.away_score,
                    "predicted_home": pred.predicted_home if pred else "–",
                    "predicted_away": pred.predicted_away if pred else "–",
                    "points": pred.points_awarded if pred else 0,
                })

            # Build per-user league rows with current rank and movement
            league_rows = []
            for member, league in memberships_by_user.get(user.id, []):
                current_rank = await get_user_rank(league.id, user.id) or 0
                prev_rank = prev_rank_by_user_league.get((user.id, league.id))
                movement = (prev_rank - current_rank) if prev_rank is not None else 0
                league_rows.append({
                    "name": league.name,
                    "rank": current_rank,
                    "movement": movement,
                })

            context = {
                "user_name": user.display_name,
                "tournament_name": tournament.name,
                "round_name": round_name,
                "site_url": site_url,
                "matches": user_match_rows,
                "leagues": league_rows,
                "upcoming_fixtures": [
                    {"home_team": f.home_team, "away_team": f.away_team, "kickoff": str(f.kickoff_time)}
                    for f in upcoming_fixtures
                ],
                "next_round_name": next_round_name,
                "next_round_lock_time": next_round_lock_time,
            }
            await email_service.send_email(
                db,
                user_id=user.id,
                to_address=user.email,
                email_type=EmailType.round_summary,
                context=context,
                tournament_id=tournament_id,
            )

    await redis_client.set(guard_key, "1")


@celery_app.task
def resolve_completed_fixture(fixture_id: int):
    from core.redis_client import close_redis
    async def run():
        try:
            await _resolve_completed_fixture(fixture_id)
        finally:
            await close_redis()
    asyncio.run(run())


@celery_app.task
def resolve_group_standings(group_code: str):
    from core.redis_client import close_redis
    async def run():
        try:
            await _resolve_group_standings(group_code)
        finally:
            await close_redis()
    asyncio.run(run())


@celery_app.task
def resolve_ko_stage(tournament_id: int, stage_value: str):
    from core.redis_client import close_redis
    async def run():
        try:
            await _resolve_ko_stage(tournament_id, stage_value)
        finally:
            await close_redis()
    asyncio.run(run())


@celery_app.task
def send_round_summary(tournament_id: int, stage_value: str, matchday: int | None):
    from core.redis_client import close_redis
    async def run():
        try:
            await _send_round_summary_async(tournament_id, stage_value, matchday)
        finally:
            await close_redis()
    asyncio.run(run())

