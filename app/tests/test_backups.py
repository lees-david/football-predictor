"""
Tests for backup administration endpoints and services.
"""
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from httpx import AsyncClient, ASGITransport

from api.deps import get_db
from core.security import create_access_token
from main import app
from models.user import User, UserRole
from services.backup_service import parse_db_url

def _admin():
    u = MagicMock(spec=User)
    u.id = 1
    u.email = "admin@example.com"
    u.role = UserRole.admin
    u.is_active = True
    return u

def _db_mock(*responses):
    session = AsyncMock()
    it = iter(responses)

    async def _exec(_stmt):
        val = next(it, None)
        result = MagicMock()
        if isinstance(val, list):
            scalars = MagicMock()
            scalars.all.return_value = val
            result.scalars.return_value = scalars
        else:
            result.scalar_one_or_none.return_value = val
            result.scalar_one.return_value = val
        return result

    session.execute = _exec
    session.add = MagicMock()
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session

@pytest.fixture(autouse=True)
def _no_redis():
    with patch("core.rate_limit.redis_client") as m:
        m.incr = AsyncMock(return_value=1)
        m.expire = AsyncMock()
        m.get = AsyncMock(return_value=None)
        m.set = AsyncMock(return_value=True)
        m.delete = AsyncMock()
        yield m

def test_parse_db_url():
    """Verify that parsing DB URLs strips the async driver suffix correctly."""
    url1 = "postgresql+asyncpg://user:password@host:5432/dbname"
    res1 = parse_db_url(url1)
    assert res1["host"] == "host"
    assert res1["port"] == "5432"
    assert res1["user"] == "user"
    assert res1["password"] == "password"
    assert res1["dbname"] == "dbname"

    url2 = "postgres://anotheruser:secretpwd@db.host.internal:5433/prod_db"
    res2 = parse_db_url(url2)
    assert res2["host"] == "db.host.internal"
    assert res2["port"] == "5433"
    assert res2["user"] == "anotheruser"
    assert res2["password"] == "secretpwd"
    assert res2["dbname"] == "prod_db"

@pytest.mark.asyncio
@patch("services.backup_service.list_backups")
async def test_get_backups_success(mock_list):
    mock_list.return_value = [
        {"filename": "backup_20260605_120000.dump", "created_at": "2026-06-05T12:00:00Z", "size_bytes": 1024}
    ]
    admin = _admin()
    session = _db_mock(admin)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get(
                "/api/v1/admin/backups",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["filename"] == "backup_20260605_120000.dump"
    finally:
        app.dependency_overrides.pop(get_db, None)

@pytest.mark.asyncio
@patch("services.backup_service.create_db_backup")
async def test_post_backup_success(mock_create):
    mock_create.return_value = {
        "filename": "backup_20260605_120000.dump",
        "filepath": "/app/backups/backup_20260605_120000.dump",
        "size_bytes": 1024,
        "cleaned_count": 0
    }
    admin = _admin()
    session = _db_mock(admin)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/admin/backups",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 201
        assert r.json()["filename"] == "backup_20260605_120000.dump"
    finally:
        app.dependency_overrides.pop(get_db, None)
