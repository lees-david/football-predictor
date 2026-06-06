"""
Scheduled database backup Celery task — checks database settings periodically (every 5 mins).
If backup is enabled and current UTC time matches/exceeds the configured schedule,
runs a database backup and updates the last run timestamp.
"""
import asyncio
import logging
from datetime import datetime, timezone, time

from core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="workers.backups.run_scheduled_backup")
def run_scheduled_backup():
    from core.redis_client import close_redis
    async def run():
        try:
            await _run_scheduled_backup_async()
        finally:
            await close_redis()
    asyncio.run(run())


async def _run_scheduled_backup_async() -> None:
    from core.database import AsyncSessionLocal
    from sqlalchemy import select
    from models.setting import Setting
    from services.backup_service import create_db_backup

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Setting).where(
                Setting.key.in_(["backup_enabled", "backup_time", "backup_retention_days", "backup_last_run"])
            )
        )
        settings_dict = {item.key: item.value for item in res.scalars().all()}

        enabled = settings_dict.get("backup_enabled") == "true"
        if not enabled:
            return

        time_str = settings_dict.get("backup_time", "03:00")
        try:
            hour, minute = map(int, time_str.split(":"))
            scheduled_time = time(hour=hour, minute=minute)
        except Exception:
            logger.warning("Invalid backup_time setting format: %s. Using default 03:00 UTC.", time_str)
            scheduled_time = time(hour=3, minute=0)

        retention_str = settings_dict.get("backup_retention_days", "7")
        try:
            retention_days = int(retention_str)
        except Exception:
            retention_days = 7

        last_run_str = settings_dict.get("backup_last_run", "")

        now_utc = datetime.now(timezone.utc)
        current_date_str = now_utc.strftime("%Y-%m-%d")

        if last_run_str == current_date_str:
            return

        if now_utc.time() >= scheduled_time:
            logger.info("Triggering scheduled database backup at %s UTC", now_utc.isoformat())
            try:
                backup_info = create_db_backup(retention_days=retention_days)
                logger.info(
                    "Scheduled backup completed: %s (%d bytes). Deleted %d old backups.",
                    backup_info["filename"],
                    backup_info["size_bytes"],
                    backup_info["cleaned_count"]
                )

                res_last = await db.execute(select(Setting).where(Setting.key == "backup_last_run"))
                last_run_setting = res_last.scalar_one_or_none()
                if not last_run_setting:
                    last_run_setting = Setting(key="backup_last_run", value=current_date_str)
                    db.add(last_run_setting)
                else:
                    last_run_setting.value = current_date_str

                await db.commit()
            except Exception as e:
                logger.exception("Failed to execute scheduled database backup: %s", e)
