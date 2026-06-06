from celery import Celery
from celery.schedules import crontab
import os

# Create Celery instance
celery_app = Celery(
    "worldcup_tasks",
    broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    include=[
        "workers.sports_poller",
        "workers.daily_digest",
        "workers.bracket_engine",
        "workers.points_recalc",
        "workers.backups",
    ]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

# Beat Schedule Definition
celery_app.conf.beat_schedule = {
    # Daily fixture sync (1 API call) — runs once at 06:00 UTC every day
    "daily-fixture-sync": {
        "task": "workers.sports_poller.daily_fixture_sync",
        "schedule": crontab(hour=6, minute=0),
    },
    # Live match poller — runs every minute; worker self-guards using DB settings interval
    "poll-live-fixtures": {
        "task": "workers.sports_poller.poll_live_fixtures",
        "schedule": crontab(minute="*"),
    },
    # Daily digest — fires at 18:00 UTC (configurable based on expected event conclusion times)
    "daily-digest": {
        "task": "workers.daily_digest.send_daily_digest",
        "schedule": crontab(hour=18, minute=0),
    },
    # Nightly reconciliation: rebuild User.total_points from the ledger and resync Redis
    "points-recalculate-all": {
        "task": "workers.points_recalc.recalculate_all_user_points",
        "schedule": crontab(hour=4, minute=0),
    },
    # Check if a scheduled database backup needs to run — runs every 5 minutes
    "run-scheduled-backup": {
        "task": "workers.backups.run_scheduled_backup",
        "schedule": crontab(minute="*/5"),
    },
}
