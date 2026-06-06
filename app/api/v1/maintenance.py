from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
import os

from api.deps import get_db, get_current_admin
from models.user import User
from services.maintenance import (
    get_maintenance_status,
    update_maintenance_settings,
    get_active_users_count,
    check_git_updates,
    queue_immediate_update
)

router = APIRouter()

class MaintenanceSettingsUpdate(BaseModel):
    enabled: bool
    start_time: str
    end_time: str
    message: str
    auto_enabled: bool
    preferred_time: str
    git_check_interval: int = 10

@router.get("/status")
async def read_maintenance_status(db: AsyncSession = Depends(get_db)):
    """Public endpoint for checking system maintenance status (no auth needed)."""
    return await get_maintenance_status(db)

@router.get("/admin/status")
async def read_admin_maintenance_status(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Admin-only status check including active user count and version comparisons."""
    status_info = await get_maintenance_status(db)
    active_users = await get_active_users_count()
    git_status = await check_git_updates(db)
    
    return {
        "schedule": status_info,
        "active_users": active_users,
        "git": git_status
    }

@router.put("/admin/settings")
async def update_admin_maintenance_settings(
    payload: MaintenanceSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Admin endpoint to update scheduled maintenance parameters."""
    await update_maintenance_settings(
        db=db,
        enabled=payload.enabled,
        start_time=payload.start_time,
        end_time=payload.end_time,
        message=payload.message,
        auto_enabled=payload.auto_enabled,
        preferred_time=payload.preferred_time,
        git_check_interval=payload.git_check_interval
    )
    return {"message": "Maintenance settings updated successfully"}

@router.post("/admin/queue-update")
async def trigger_admin_immediate_update(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Trigger an immediate pull and update by setting update flags."""
    await queue_immediate_update(db)
    return {"message": "Update and restart queued. It will execute on the next host execution."}

@router.post("/admin/check-git")
async def trigger_git_check_now(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Flag that a Git version control check is requested immediately."""
    from services.maintenance import set_db_setting
    await set_db_setting(db, "maintenance:force_git_check", "true")
    await db.commit()
    return {"message": "Git check flagged. It will run on the next host execution."}

@router.get("/admin/logs")
async def read_maintenance_logs(
    lines: int = 100,
    _: User = Depends(get_current_admin)
):
    """Admin endpoint to read the tail of deploy/pull log files."""
    log_paths = [
        "logs/auto_deploy.log",
        "/app/logs/auto_deploy.log",
        "auto_deploy.log",
        "app/auto_deploy.log",
        "/app/auto_deploy.log"
    ]
    log_content = "No deploy logs found on server."
    
    for path in log_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    log_lines = f.readlines()
                    tail_lines = log_lines[-lines:]
                    log_content = "".join(tail_lines)
                break
            except Exception as e:
                log_content = f"Error reading log file: {e}"
                
    return {"logs": log_content}


class ActiveUserDetail(BaseModel):
    id: int
    email: str
    display_name: str
    last_active: str

@router.get("/admin/active-users", response_model=list[ActiveUserDetail])
async def read_active_users_list(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin)
):
    """Retrieve detailed list of currently active users."""
    from services.maintenance import get_active_users_list
    return await get_active_users_list(db)

