"""
Daily digest Celery task — fires at 18:00 UTC on match days.

For each active tournament with email_mode=LIVE and daily_digest enabled,
collects today's completed fixtures and sends one consolidated email per
qualifying user (opted-in, in a league with emails_enabled).
"""
import asyncio
import logging
from datetime import datetime, timezone, date

from core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task
def send_daily_digest():
    from core.redis_client import close_redis
    async def run():
        try:
            await _send_daily_digest_async()
        finally:
            await close_redis()
    asyncio.run(run())


async def _send_daily_digest_async() -> None:
    from core.database import AsyncSessionLocal
    from sqlalchemy import select
    from models.tournament import Tournament, EmailMode
    from models.tournament_email_settings import TournamentEmailSettings
    from models.email_template import EmailType
    from models.fixture import Fixture, FixtureStatus
    from models.league import League
    from models.league_member import LeagueMember
    from models.user import User
    from models.user_email_preference import UserEmailPreference
    from services import email_service

    today = date.today()
    logger.info("send_daily_digest: running for %s", today)

    async with AsyncSessionLocal() as db:
        # Active tournaments in LIVE mode with daily_digest enabled
        tournaments_res = await db.execute(
            select(Tournament).where(
                Tournament.is_active == True,
                Tournament.email_mode == EmailMode.live,
            )
        )
        for tournament in tournaments_res.scalars().all():
            tes_res = await db.execute(
                select(TournamentEmailSettings).where(
                    TournamentEmailSettings.tournament_id == tournament.id,
                    TournamentEmailSettings.email_type == EmailType.daily_digest,
                    TournamentEmailSettings.enabled == True,
                )
            )
            if not tes_res.scalar_one_or_none():
                continue

            # Today's completed fixtures
            fixtures_res = await db.execute(
                select(Fixture).where(
                    Fixture.tournament_id == tournament.id,
                    Fixture.status == FixtureStatus.completed,
                )
            )
            todays_fixtures = [
                f for f in fixtures_res.scalars().all()
                if f.kickoff_time and f.kickoff_time.date() == today
            ]

            if not todays_fixtures:
                logger.info("No completed fixtures today for tournament %s, skipping digest", tournament.id)
                continue

            # Find qualifying users
            users_res = await db.execute(
                select(User)
                .join(LeagueMember, LeagueMember.user_id == User.id)
                .join(League, LeagueMember.league_id == League.id)
                .join(UserEmailPreference, (
                    UserEmailPreference.user_id == User.id) & (
                    UserEmailPreference.email_type == EmailType.daily_digest
                ))
                .where(
                    League.tournament_id == tournament.id,
                    League.emails_enabled == True,
                    User.is_active == True,
                    UserEmailPreference.opted_in == True,
                )
                .distinct()
            )
            qualifying_users = users_res.scalars().all()
            logger.info(
                "send_daily_digest: tournament %s, %d fixtures today, %d users",
                tournament.id, len(todays_fixtures), len(qualifying_users)
            )

            digest_date = today.strftime("%-d %b %Y") if hasattr(today, "strftime") else str(today)
            for user in qualifying_users:
                context = {
                    "user_name": user.display_name,
                    "tournament_name": tournament.name,
                    "digest_date": digest_date,
                    "site_url": await _get_site_url(db),
                    "matches": [
                        {
                            "home_team": f.home_team,
                            "away_team": f.away_team,
                            "home_score": f.home_score,
                            "away_score": f.away_score,
                            "predicted_home": None,
                            "predicted_away": None,
                            "points": 0,
                        }
                        for f in todays_fixtures
                    ],
                    "leagues": [],
                    "upcoming_fixtures": [],
                    "next_round_name": None,
                    "next_round_lock_time": None,
                }
                await email_service.send_email(
                    db,
                    user_id=user.id,
                    to_address=user.email,
                    email_type=EmailType.daily_digest,
                    context=context,
                    tournament_id=tournament.id,
                )


async def _get_site_url(db) -> str:
    from services.email_service import get_site_url
    return await get_site_url(db)
