#!/bin/bash
# check_and_deploy.sh - Automated update checker & downtime poller
#
# Run this script on your host machine in a cron job (e.g. every 2 to 5 minutes).
# It handles:
# 1. Syncing local/remote git hashes directly to database settings (fixing Errno 2 git errors).
# 2. Checking if "Automated updates" are enabled and if the preferred daily window is reached.
# 3. Scheduling a 15-minute warning banner if updates are available.
# 4. Triggering the offline lockdown, migration, and reload once the start time is reached.

set -e

# Change directory to the repository root where this script resides
cd "$(dirname "$0")"

# Ensure common executable paths are available in cron environment
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/home/dockeradmin

mkdir -p data/logs
LOG_FILE="data/logs/auto_deploy.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 1. Read configurations, hashes, and active users from the database first
log "Querying system configurations and status..."
CONFIG_VARS=$(docker compose exec -T app python -c "
import asyncio
from core.database import AsyncSessionLocal
from models.setting import Setting
from sqlalchemy import select
from services.maintenance import get_active_users_count

async def run():
    keys = [
        'maintenance:auto_enabled',
        'maintenance:preferred_time',
        'maintenance:start_time',
        'maintenance:enabled',
        'maintenance:git_check_interval',
        'maintenance:last_git_check',
        'maintenance:local_hash',
        'maintenance:remote_hash',
        'maintenance:git_up_to_date',
        'maintenance:force_git_check'
    ]
    async with AsyncSessionLocal() as db:
        res = {}
        for k in keys:
            r = await db.execute(select(Setting).where(Setting.key == k))
            row = r.scalar_one_or_none()
            res[k] = row.value if row else ''
        
        active_users = await get_active_users_count()
        
        print(f\"AUTO_ENABLED='{res.get('maintenance:auto_enabled', 'false')}'\")
        print(f\"PREFERRED_TIME='{res.get('maintenance:preferred_time', '03:00')}'\")
        print(f\"START_TIME='{res.get('maintenance:start_time', '')}'\")
        print(f\"EMERGENCY_ACTIVE='{res.get('maintenance:enabled', 'false')}'\")
        print(f\"GIT_CHECK_INTERVAL='{res.get('maintenance:git_check_interval', '10')}'\")
        print(f\"LAST_GIT_CHECK='{res.get('maintenance:last_git_check', '0')}'\")
        print(f\"DB_LOCAL_HASH='{res.get('maintenance:local_hash', '')}'\")
        print(f\"DB_REMOTE_HASH='{res.get('maintenance:remote_hash', '')}'\")
        print(f\"DB_UP_TO_DATE='{res.get('maintenance:git_up_to_date', 'true')}'\")
        print(f\"FORCE_GIT_CHECK='{res.get('maintenance:force_git_check', 'false')}'\")
        print(f\"ACTIVE_USERS='{active_users}'\")

asyncio.run(run())
" 2>/dev/null || echo "")

AUTO_ENABLED="false"
PREFERRED_TIME="03:00"
START_TIME=""
EMERGENCY_ACTIVE="false"
GIT_CHECK_INTERVAL="10"
LAST_GIT_CHECK="0"
DB_LOCAL_HASH=""
DB_REMOTE_HASH=""
DB_UP_TO_DATE="true"
FORCE_GIT_CHECK="false"
ACTIVE_USERS="999"

if [ -n "$CONFIG_VARS" ]; then
    eval "$CONFIG_VARS"
fi

NOW_UTC=$(date -u +%s)

# Calculate elapsed time since last git check
if ! [[ "$LAST_GIT_CHECK" =~ ^[0-9]+$ ]]; then
    LAST_GIT_CHECK=0
fi
if ! [[ "$GIT_CHECK_INTERVAL" =~ ^[0-9]+$ ]]; then
    GIT_CHECK_INTERVAL=10
fi

INTERVAL_SECS=$((GIT_CHECK_INTERVAL * 60))
ELAPSED=$((NOW_UTC - LAST_GIT_CHECK))

LOCAL_HASH="$DB_LOCAL_HASH"
REMOTE_HASH="$DB_REMOTE_HASH"
UP_TO_DATE="$DB_UP_TO_DATE"

# Run Git check if interval has elapsed, hashes are empty, or check is forced
if [ "$FORCE_GIT_CHECK" = "true" ] || [ "$ELAPSED" -ge "$INTERVAL_SECS" ] || [ -z "$LOCAL_HASH" ] || [ -z "$REMOTE_HASH" ]; then
    if [ "$FORCE_GIT_CHECK" = "true" ]; then
        log "Forced Git check requested by administrator. Fetching remote updates..."
    else
        log "Git check interval reached (${GIT_CHECK_INTERVAL} mins elapsed). Fetching remote updates..."
    fi
    git fetch origin main || log "Warning: git fetch failed (remote unreachable or git error)."

    LOCAL_HASH=$(git rev-parse HEAD || echo "unknown")
    REMOTE_HASH=$(git rev-parse origin/main || echo "unknown")
    UP_TO_DATE="true"
    if [ "$LOCAL_HASH" != "$REMOTE_HASH" ] && [ "$LOCAL_HASH" != "unknown" ]; then
        UP_TO_DATE="false"
    fi

    # Push new hashes and update last_git_check timestamp, reset force_git_check flag
    log "Syncing git commit hashes to database settings (Local: ${LOCAL_HASH::8}, Remote: ${REMOTE_HASH::8})..."
    docker compose exec -T app python -c "
import asyncio
from core.database import AsyncSessionLocal
from models.setting import Setting
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        for k, v in [
            ('maintenance:local_hash', '$LOCAL_HASH'),
            ('maintenance:remote_hash', '$REMOTE_HASH'),
            ('maintenance:git_up_to_date', '$UP_TO_DATE'),
            ('maintenance:last_git_check', '$NOW_UTC'),
            ('maintenance:force_git_check', 'false')
        ]:
            res = await db.execute(select(Setting).where(Setting.key == k))
            row = res.scalar_one_or_none()
            if row:
                row.value = v
            else:
                db.add(Setting(key=k, value=v))
        await db.commit()

asyncio.run(run())
" || log "Warning: Failed to sync commit hashes to database settings."
else
    log "Skipping git fetch. Using cached hashes (Local: ${LOCAL_HASH::8}, Remote: ${REMOTE_HASH::8}, Up-to-date: ${UP_TO_DATE}). Next check in $((INTERVAL_SECS - ELAPSED)) seconds."
fi

# 4. Check if an active/scheduled maintenance window is reached
NOW_UTC=$(date -u +%s)
START_UTC=0
if [ -n "$START_TIME" ]; then
    # Parse ISO-8601 start time to epoch UTC
    START_UTC=$(date -d "${START_TIME}" +%s 2>/dev/null || date -u -d "${START_TIME}" +%s 2>/dev/null || echo 0)
fi

# Emergency cleanup: always clear maintenance flags if the script exits unexpectedly
_trap_cleanup() {
    if [ "${_DEPLOY_STARTED:-0}" = "1" ] && [ "${_DEPLOY_COMPLETE:-0}" = "0" ]; then
        log "ERROR: Script exited unexpectedly during deploy — clearing maintenance flags."
        docker compose exec -T redis redis-cli set maintenance:active "0" || true
        docker compose exec -T app python -c "
import asyncio
from core.database import AsyncSessionLocal
from models.setting import Setting
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        for k, v in [('maintenance:enabled', 'false'), ('maintenance:start_time', ''), ('maintenance:end_time', '')]:
            res = await db.execute(select(Setting).where(Setting.key == k))
            row = res.scalar_one_or_none()
            if row:
                row.value = v
            else:
                db.add(Setting(key=k, value=v))
        await db.commit()

asyncio.run(run())
" || true
    fi
}
trap '_trap_cleanup' ERR EXIT

# Function to execute database updates for scheduling
update_schedule_db() {
    local start=$1
    local end=$2
    local enabled=$3
    local active_redis=$4
    
    docker compose exec -T app python -c "
import asyncio
from core.database import AsyncSessionLocal
from models.setting import Setting
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        for k, v in [('maintenance:start_time', '$start'), ('maintenance:end_time', '$end'), ('maintenance:enabled', '$enabled')]:
            res = await db.execute(select(Setting).where(Setting.key == k))
            row = res.scalar_one_or_none()
            if row:
                row.value = v
            else:
                db.add(Setting(key=k, value=v))
        await db.commit()

asyncio.run(run())
" || true

    docker compose exec -T redis redis-cli set maintenance:active "$active_redis" || true
}

# 5. Check if it's time to trigger updates
if [ "$EMERGENCY_ACTIVE" = "true" ] || ( [ "$START_UTC" -gt 0 ] && [ "$NOW_UTC" -ge "$START_UTC" ] ) || ( [ "$AUTO_ENABLED" = "true" ] && [ "$UP_TO_DATE" = "false" ] && [ "$ACTIVE_USERS" -eq 0 ] ); then
    if [ "$EMERGENCY_ACTIVE" != "true" ] && ( [ -z "$START_TIME" ] || [ "$NOW_UTC" -lt "$START_UTC" ] ); then
        log "Auto-update triggered immediately because there are no active users logged on."
    fi
    # Execute actual pull and reload
    if [ "$UP_TO_DATE" = "false" ]; then
        _DEPLOY_STARTED=1
        log "Pulling latest pre-built images from registry..."
        # Pull is done BEFORE maintenance mode. If it fails (e.g., CI build failed),
        # the script halts here and the app remains online running the old containers.
        docker compose pull app celery_worker celery_beat
        
        log "Images pulled successfully. Enforcing maintenance lockdown..."
        docker compose exec -T redis redis-cli set maintenance:active "1" || true
        
        log "Updating local git directory..."
        git fetch origin main
        git reset --hard origin/main
        
        log "Recreating app, celery_worker, and celery_beat containers..."
        docker compose up -d --no-deps app celery_worker celery_beat
        
        log "Running Alembic migrations..."
        docker compose exec -T app alembic upgrade head
        
        log "Flushing app Redis cache keys..."
        docker compose exec -T redis redis-cli del cache:match_list || true

        # Sync the new hashes to DB so the admin widget reflects the deployed commit
        DEPLOYED_HASH=$(git rev-parse HEAD || echo "unknown")
        log "Syncing deployed commit hashes to database settings (Local: ${DEPLOYED_HASH::8}, Remote: ${DEPLOYED_HASH::8})..."
        docker compose exec -T app python -c "
import asyncio
from core.database import AsyncSessionLocal
from models.setting import Setting
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        for k, v in [
            ('maintenance:local_hash', '$DEPLOYED_HASH'),
            ('maintenance:remote_hash', '$DEPLOYED_HASH'),
            ('maintenance:git_up_to_date', 'true'),
        ]:
            res = await db.execute(select(Setting).where(Setting.key == k))
            row = res.scalar_one_or_none()
            if row:
                row.value = v
            else:
                db.add(Setting(key=k, value=v))
        await db.commit()

asyncio.run(run())
" || log "Warning: Failed to sync deployed commit hashes to database settings."

        log "Upgrade successfully deployed."
        _DEPLOY_COMPLETE=1
    else
        log "No updates found to pull. Skipping deploy execution."
    fi
    
    # Restore operational status
    log "Restoring system back online..."
    update_schedule_db "" "" "false" "0"
    
elif [ "$AUTO_ENABLED" = "true" ] && [ "$UP_TO_DATE" = "false" ]; then
    # Compare current local server time (HH:MM) to preferred daily time
    CUR_TIME=$(date '+%H:%M')
    
    # Check if preferred time matches current time within a 5-minute execution window
    cur_hour=$(date '+%H')
    cur_min=$(date '+%M')
    cur_mins=$((10#$cur_hour * 60 + 10#$cur_min))
    
    pref_hour=$(echo "$PREFERRED_TIME" | cut -d: -f1)
    pref_min=$(echo "$PREFERRED_TIME" | cut -d: -f2)
    pref_mins=$((10#$pref_hour * 60 + 10#$pref_min))
    
    diff=$((cur_mins - pref_mins))
    if [ $diff -lt 0 ]; then diff=$(( -diff )); fi
    
    # If the time matches (within a 5-minute range) and we haven't scheduled yet
    if [ $diff -le 4 ] && [ -z "$START_TIME" ]; then
        log "Preferred update window matched ($CUR_TIME)! Scheduling 15-minute countdown warning..."
        
        # Schedule start time in 15 minutes, end time in 30 minutes (UTC ISO format)
        START_ISO=$(date -u -d "+15 minutes" +"%Y-%m-%dT%H:%M:%SZ")
        END_ISO=$(date -u -d "+30 minutes" +"%Y-%m-%dT%H:%M:%SZ")
        
        update_schedule_db "$START_ISO" "$END_ISO" "false" "0"
        log "Warning banner scheduled: Start at $START_ISO, End at $END_ISO."
    fi
fi
