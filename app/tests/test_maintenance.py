from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from httpx import AsyncClient, ASGITransport
from datetime import datetime, timezone

from api.deps import get_db
from core.security import create_access_token
from main import app
from models.user import User, UserRole
from models.setting import Setting

_NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)

def _user(role=UserRole.player):
    u = MagicMock(spec=User)
    u.id = 1
    u.email = "test@example.com"
    u.role = role
    u.is_active = True
    u.display_name = "Test User"
    u.team_name = "Test Team"
    u.total_points = 0
    u.can_manage_leagues = False
    u.can_invite_users = True
    u.can_manage_tournaments = False
    u.created_at = _NOW
    u.updated_at = _NOW
    u.current_rank = None
    return u

def _db(user_val=None, settings_dict=None):
    session = AsyncMock()
    if settings_dict is None:
        settings_dict = {}

    async def _exec(stmt):
        result = MagicMock()
        stmt_str = str(stmt).lower()
        
        # If it's a User query
        if "from users" in stmt_str or "where users.id" in stmt_str:
            result.scalar_one_or_none.return_value = user_val
            return result
            
        # If it's a Setting query
        key_val = None
        try:
            key_val = stmt.whereclause.right.value
        except Exception:
            pass
            
        if key_val in settings_dict:
            row = Setting(key=key_val, value=settings_dict[key_val])
            result.scalar_one_or_none.return_value = row
        else:
            result.scalar_one_or_none.return_value = None
        return result

    session.execute = _exec
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session

def _override(session):
    async def _gen():
        yield session
    return _gen

@pytest.fixture(autouse=True)
def _no_redis():
    with patch("core.redis_client.redis_client") as m:
        m.get = AsyncMock(return_value=None)
        m.set = AsyncMock()
        m.delete = AsyncMock()
        m.zadd = AsyncMock()
        m.zremrangebyscore = AsyncMock()
        m.zcard = AsyncMock(return_value=5)
        yield m

async def test_read_maintenance_status_inactive():
    session = _db(settings_dict={
        "maintenance:enabled": "false",
        "maintenance:start_time": "",
        "maintenance:end_time": "",
        "maintenance:message": "Offline for upgrades"
    })
    app.dependency_overrides[get_db] = _override(session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/maintenance/status")
        assert r.status_code == 200
        data = r.json()
        assert data["active"] is False
        assert data["message"] == "Offline for upgrades"
    finally:
        app.dependency_overrides.pop(get_db, None)

async def test_read_maintenance_status_active():
    session = _db(settings_dict={
        "maintenance:enabled": "true",
        "maintenance:start_time": "",
        "maintenance:end_time": "",
        "maintenance:message": "Upgrading database"
    })
    app.dependency_overrides[get_db] = _override(session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/maintenance/status")
        assert r.status_code == 200
        data = r.json()
        assert data["active"] is True
        assert data["message"] == "Upgrading database"
    finally:
        app.dependency_overrides.pop(get_db, None)

async def test_player_request_during_maintenance_blocked():
    user_row = _user(role=UserRole.player)
    session = _db(user_val=user_row, settings_dict={
        "maintenance:enabled": "true",
        "maintenance:start_time": "",
        "maintenance:end_time": ""
    })
    app.dependency_overrides[get_db] = _override(session)
    token = create_access_token(subject=1)
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 503
        assert "maintenance" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)

async def test_admin_request_during_maintenance_allowed():
    user_row = _user(role=UserRole.admin)
    session = _db(user_val=user_row)
    app.dependency_overrides[get_db] = _override(session)
    token = create_access_token(subject=1)
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "test@example.com"
    finally:
        app.dependency_overrides.pop(get_db, None)

async def test_trigger_admin_immediate_update():
    user_row = _user(role=UserRole.admin)
    session = _db(user_val=user_row)
    app.dependency_overrides[get_db] = _override(session)
    token = create_access_token(subject=1)
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/maintenance/admin/queue-update", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert "queued" in r.json()["message"].lower()
        session.commit.assert_called()
    finally:
        app.dependency_overrides.pop(get_db, None)
