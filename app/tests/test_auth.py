"""
Auth flow tests: register, login, JWT validation, and access control.

All tests use dependency_overrides to inject a mock AsyncSession, so no
real database or Redis instance is required.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from datetime import datetime, timezone

from api.deps import get_db
from core.security import create_access_token, get_password_hash
from main import app
from models.user import User, UserRole

_NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


# ── helpers ───────────────────────────────────────────────────────────────────

def _user(id_=1, email="test@example.com", role=UserRole.player, is_active=True):
    u = MagicMock(spec=User)
    u.id = id_
    u.email = email
    u.hashed_password = get_password_hash("secret123")
    u.role = role
    u.is_active = is_active
    u.total_points = 0
    u.display_name = "Test User"
    u.team_name = "Test Team"
    u.can_manage_leagues = False
    u.can_invite_users = True
    u.can_manage_tournaments = False
    u.created_at = _NOW
    u.updated_at = _NOW
    u.current_rank = None
    return u


def _db(*responses):
    """Return an AsyncSession mock whose execute() calls yield responses in order.

    Pass a list → result.scalars().all() returns it.
    Pass anything else → result.scalar_one_or_none() returns it.
    """
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
    """Prevent Redis calls (rate-limiter) from failing tests."""
    with patch("core.rate_limit.redis_client") as m:
        m.incr = AsyncMock(return_value=1)
        m.expire = AsyncMock()
        yield m


# ── login ─────────────────────────────────────────────────────────────────────

async def test_login_success():
    app.dependency_overrides[get_db] = _override(_db(_user()))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/login",
                             data={"username": "test@example.com", "password": "secret123"})
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_login_wrong_password():
    app.dependency_overrides[get_db] = _override(_db(_user()))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/login",
                             data={"username": "test@example.com", "password": "badpassword"})
        assert r.status_code == 400
        assert "Incorrect" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_login_unknown_user():
    app.dependency_overrides[get_db] = _override(_db(None))
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/login",
                             data={"username": "nobody@example.com", "password": "x"})
        assert r.status_code == 400
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── register ──────────────────────────────────────────────────────────────────

async def test_register_with_legacy_invite_token():
    from models.league import League
    league = MagicMock(spec=League)
    league.id = 42
    league.is_active = True

    # execute sequence: invitation lookup → None (not found)
    #                   league lookup     → league (found via legacy token)
    #                   email check       → None (not taken)
    session = _db(None, league, None)
    app.dependency_overrides[get_db] = _override(session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "new@example.com",
                "password": "password123",
                "display_name": "New User",
                "team_name": "Test Team",
                "invite_token": "valid-legacy-token",
            })
        assert r.status_code == 200
        assert "access_token" in r.json()
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_register_invalid_invite_token():
    # Both invitation and league lookups return None → rejected
    session = _db(None, None)
    app.dependency_overrides[get_db] = _override(session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "new@example.com",
                "password": "password123",
                "display_name": "New User",
                "team_name": "Test Team",
                "invite_token": "bad-token",
            })
        assert r.status_code == 400
        assert "invite" in r.json()["detail"].lower() or "invalid" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_register_duplicate_email():
    from models.league import League
    league = MagicMock(spec=League)
    league.id = 42
    league.is_active = True

    existing = _user(email="taken@example.com")
    # invitation → None, league → found, email check → existing user
    session = _db(None, league, existing)
    app.dependency_overrides[get_db] = _override(session)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "taken@example.com",
                "password": "password123",
                "display_name": "Dupe",
                "team_name": "Dupe Team",
                "invite_token": "valid-token",
            })
        assert r.status_code == 400
        assert "already registered" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── JWT / protected endpoints ─────────────────────────────────────────────────

async def test_protected_endpoint_no_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/v1/users/me")
    assert r.status_code == 401


async def test_protected_endpoint_malformed_token():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/api/v1/users/me",
                        headers={"Authorization": "Bearer not.a.valid.jwt"})
    assert r.status_code == 401


async def test_protected_endpoint_valid_token():
    app.dependency_overrides[get_db] = _override(_db(_user()))
    token = create_access_token(subject=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/users/me",
                            headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "test@example.com"
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_admin_endpoint_as_player_is_forbidden():
    app.dependency_overrides[get_db] = _override(_db(_user(role=UserRole.player)))
    token = create_access_token(subject=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/admin/users",
                            headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 403
    finally:
        app.dependency_overrides.pop(get_db, None)


async def test_inactive_user_is_rejected():
    app.dependency_overrides[get_db] = _override(_db(_user(is_active=False)))
    token = create_access_token(subject=1)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/api/v1/users/me",
                            headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 400
        assert "Inactive" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)
