import os
import subprocess
from datetime import datetime, timezone
from urllib.parse import urlparse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.config import settings

BACKUPS_DIR = "/app/backups"

def parse_db_url(url: str) -> dict:
    """
    Extracts database connection details (host, port, user, password, dbname)
    from a database connection URL, stripping driver suffixes like +asyncpg.
    """
    clean_url = url
    if "://" in clean_url:
        scheme, rest = clean_url.split("://", 1)
        if "+" in scheme:
            scheme = scheme.split("+")[0]
        clean_url = f"{scheme}://{rest}"
    
    if clean_url.startswith("postgres://"):
        clean_url = clean_url.replace("postgres://", "postgresql://", 1)
        
    parsed = urlparse(clean_url)
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "dbname": parsed.path.lstrip("/") or "postgres"
    }

def create_db_backup(retention_days: int = 7) -> dict:
    """
    Executes pg_dump -Fc to create a custom-format binary backup of the database
    and removes backups older than the retention threshold.
    """
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.dump"
    filepath = os.path.join(BACKUPS_DIR, filename)
    
    db_info = parse_db_url(settings.DATABASE_URL)
    
    env = os.environ.copy()
    env["PGPASSWORD"] = db_info["password"]
    
    cmd = [
        "pg_dump",
        "-h", db_info["host"],
        "-p", db_info["port"],
        "-U", db_info["user"],
        "-d", db_info["dbname"],
        "-F", "c",
        "-f", filepath
    ]
    
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {result.stderr}")
        
    # Clean up old backups
    cleaned_count = 0
    if retention_days > 0:
        now = datetime.now(timezone.utc)
        for f in os.listdir(BACKUPS_DIR):
            if f.startswith("backup_") and f.endswith(".dump"):
                f_path = os.path.join(BACKUPS_DIR, f)
                try:
                    dt_str = f[7:22]
                    file_dt = datetime.strptime(dt_str, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
                    age_days = (now - file_dt).days
                    if age_days > retention_days:
                        os.remove(f_path)
                        cleaned_count += 1
                except Exception:
                    file_time = datetime.fromtimestamp(os.path.getmtime(f_path), tzinfo=timezone.utc)
                    age_days = (now - file_time).days
                    if age_days > retention_days:
                        os.remove(f_path)
                        cleaned_count += 1
                        
    stat = os.stat(filepath)
    return {
        "filename": filename,
        "filepath": filepath,
        "size_bytes": stat.st_size,
        "cleaned_count": cleaned_count
    }

def list_backups() -> list[dict]:
    """
    Scans the backups directory and returns metadata for all backup files.
    """
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    backups = []
    for f in os.listdir(BACKUPS_DIR):
        if f.startswith("backup_") and f.endswith(".dump"):
            f_path = os.path.join(BACKUPS_DIR, f)
            try:
                stat = os.stat(f_path)
                try:
                    dt_str = f[7:22]
                    dt = datetime.strptime(dt_str, "%Y%m%d_%H%M%S")
                    created_at = dt.replace(tzinfo=timezone.utc).isoformat()
                except Exception:
                    created_at = datetime.fromtimestamp(stat.st_mtime, tzinfo=timezone.utc).isoformat()
                
                backups.append({
                    "filename": f,
                    "created_at": created_at,
                    "size_bytes": stat.st_size
                })
            except Exception:
                pass
                
    backups.sort(key=lambda x: x["created_at"], reverse=True)
    return backups

def delete_backup(filename: str):
    """
    Removes a database backup file by name.
    """
    filepath = os.path.join(BACKUPS_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
    else:
        raise FileNotFoundError(f"Backup file {filename} not found")

async def restore_db_backup(filename: str, db: AsyncSession) -> str:
    """
    Restores the database from a custom-format dump file.
    Wipes the existing public schema first to ensure clean state.
    """
    filepath = os.path.join(BACKUPS_DIR, filename)
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Backup file {filename} not found")
        
    # Drop and recreate schema public
    await db.execute(text("DROP SCHEMA public CASCADE;"))
    await db.execute(text("CREATE SCHEMA public;"))
    await db.commit()
    
    db_info = parse_db_url(settings.DATABASE_URL)
    
    env = os.environ.copy()
    env["PGPASSWORD"] = db_info["password"]
    
    cmd = [
        "pg_restore",
        "-h", db_info["host"],
        "-p", db_info["port"],
        "-U", db_info["user"],
        "-d", db_info["dbname"],
        "--no-owner",
        "--no-privileges",
        filepath
    ]
    
    result = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if result.returncode not in (0, 1):  # 1 is often just non-fatal warnings
        raise RuntimeError(f"pg_restore failed: {result.stderr}")
        
    return result.stdout or result.stderr
