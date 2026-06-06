import time
import os
import subprocess
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import core.redis_client
from models.setting import Setting

REDIS_ACTIVE_KEY = "maintenance:active"
REDIS_USERS_KEY = "users:active"

async def get_db_setting(db: AsyncSession, key: str, default: str = "") -> str:
    res = await db.execute(select(Setting).where(Setting.key == key))
    row = res.scalar_one_or_none()
    return row.value if row else default

async def set_db_setting(db: AsyncSession, key: str, value: str) -> None:
    res = await db.execute(select(Setting).where(Setting.key == key))
    row = res.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))

async def is_maintenance_active(db: AsyncSession) -> bool:
    # 1. Check Redis cache first
    cached = await core.redis_client.redis_client.get(REDIS_ACTIVE_KEY)
    if cached == "1":
        return True
    elif cached == "0":
        return False

    # 2. Query database settings
    enabled_str = await get_db_setting(db, "maintenance:enabled", "false")
    start_str = await get_db_setting(db, "maintenance:start_time", "")
    end_str = await get_db_setting(db, "maintenance:end_time", "")

    active = False
    if enabled_str.lower() == "true":
        active = True
    elif start_str and end_str:
        try:
            now = datetime.now(timezone.utc)
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            if start_dt <= now <= end_dt:
                active = True
        except ValueError:
            pass

    # 3. Cache result in Redis for 15 seconds
    await core.redis_client.redis_client.set(REDIS_ACTIVE_KEY, "1" if active else "0", ex=15)
    return active

async def get_maintenance_status(db: AsyncSession) -> dict:
    active = await is_maintenance_active(db)
    start_str = await get_db_setting(db, "maintenance:start_time", "")
    end_str = await get_db_setting(db, "maintenance:end_time", "")
    message = await get_db_setting(db, "maintenance:message", "Scheduled system maintenance is currently underway. Please try again shortly.")
    
    # Auto-update settings
    auto_enabled_str = await get_db_setting(db, "maintenance:auto_enabled", "false")
    preferred_time = await get_db_setting(db, "maintenance:preferred_time", "03:00")
    git_check_interval_str = await get_db_setting(db, "maintenance:git_check_interval", "10")
    
    try:
        git_check_interval = int(git_check_interval_str)
    except ValueError:
        git_check_interval = 10
    
    return {
        "active": active,
        "start_time": start_str,
        "end_time": end_str,
        "message": message,
        "auto_enabled": auto_enabled_str.lower() == "true",
        "preferred_time": preferred_time,
        "git_check_interval": git_check_interval
    }

async def update_maintenance_settings(
    db: AsyncSession,
    enabled: bool,
    start_time: str,
    end_time: str,
    message: str,
    auto_enabled: bool = False,
    preferred_time: str = "03:00",
    git_check_interval: int = 10
) -> None:
    await set_db_setting(db, "maintenance:enabled", "true" if enabled else "false")
    await set_db_setting(db, "maintenance:start_time", start_time)
    await set_db_setting(db, "maintenance:end_time", end_time)
    await set_db_setting(db, "maintenance:message", message)
    await set_db_setting(db, "maintenance:auto_enabled", "true" if auto_enabled else "false")
    await set_db_setting(db, "maintenance:preferred_time", preferred_time)
    await set_db_setting(db, "maintenance:git_check_interval", str(git_check_interval))
    await db.commit()

    # Clear cached state in Redis so changes take effect immediately
    await core.redis_client.redis_client.delete(REDIS_ACTIVE_KEY)

async def get_active_users_count() -> int:
    try:
        now = int(time.time())
        five_minutes_ago = now - 300
        # Evict inactive users
        await core.redis_client.redis_client.zremrangebyscore(REDIS_USERS_KEY, "-inf", five_minutes_ago)
        # Count remaining
        return await core.redis_client.redis_client.zcard(REDIS_USERS_KEY)
    except Exception:
        return 0

async def get_active_users_list(db: AsyncSession) -> list[dict]:
    try:
        now = int(time.time())
        five_minutes_ago = now - 300
        # Evict inactive
        await core.redis_client.redis_client.zremrangebyscore(REDIS_USERS_KEY, "-inf", five_minutes_ago)
        
        # Fetch user IDs and their timestamps
        user_pairs = await core.redis_client.redis_client.zrange(REDIS_USERS_KEY, 0, -1, withscores=True)
        if not user_pairs:
            return []
            
        user_active_map = {}
        for uid_str, score in user_pairs:
            user_active_map[int(uid_str)] = int(score)
            
        if not user_active_map:
            return []
            
        from models.user import User
        res = await db.execute(select(User).where(User.id.in_(user_active_map.keys())))
        users = res.scalars().all()
        
        out = []
        for u in users:
            last_active_epoch = user_active_map.get(u.id, 0)
            last_active_dt = datetime.fromtimestamp(last_active_epoch, tz=timezone.utc)
            out.append({
                "id": u.id,
                "email": u.email,
                "display_name": u.display_name,
                "last_active": last_active_dt.isoformat()
            })
            
        out.sort(key=lambda x: x["last_active"], reverse=True)
        return out
    except Exception:
        return []

async def check_git_updates(db: AsyncSession) -> dict:
    """Read local/remote hashes populated by the check_and_deploy.sh host script."""
    local_hash = await get_db_setting(db, "maintenance:local_hash", "")
    remote_hash = await get_db_setting(db, "maintenance:remote_hash", "")
    up_to_date_str = await get_db_setting(db, "maintenance:git_up_to_date", "true")
    
    if not local_hash and not remote_hash:
        return {
            "local_hash": "Unknown",
            "remote_hash": "Unknown",
            "up_to_date": True,
            "info": "Hashes will populate on next host execution"
        }
        
    return {
        "local_hash": local_hash[:8],
        "remote_hash": remote_hash[:8],
        "up_to_date": up_to_date_str.lower() == "true"
    }

async def queue_immediate_update(db: AsyncSession) -> None:
    """Set maintenance flags to trigger an immediate pull and update on the next host execution."""
    now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    await set_db_setting(db, "maintenance:enabled", "true")
    await set_db_setting(db, "maintenance:start_time", now_str)
    await set_db_setting(db, "maintenance:end_time", "")
    await set_db_setting(db, "maintenance:message", "Immediate system update and restart triggered by administrator.")
    await db.commit()
    
    # Clear cached state in Redis
    await core.redis_client.redis_client.delete(REDIS_ACTIVE_KEY)
