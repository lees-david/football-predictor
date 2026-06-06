"""Tests for bracket endpoints (submit, retrieve, clear), invitation claiming rules, and admin tournament reset actions.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient, ASGITransport

from api.deps import get_db
from core.security import create_access_token
from main import app
from models.user import User, UserRole
from models.tournament import Tournament
from models.bracket_prediction import BracketPrediction
from models.invitation import Invitation
from models.league import League

_NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)


def _user(role=UserRole.player):
    u = MagicMock(spec=User)
    u.id = 1
    u.email = "player@example.com"
    u.role = role
    u.is_active = True
    return u


def _admin():
    return _user(role=UserRole.admin)


def _tournament(id_=1):
    t = MagicMock(spec=Tournament)
    t.id = id_
    t.name = "World Cup 2026"
    t.predictions_reset_at = None
    t.api_season = 2026
    t.api_league_id = 1
    t.is_active = True
    return t


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


# ── Bracket Submission & Retrieve ─────────────────────────────────────────────

@pytest.mark.asyncio
@patch("api.v1.bracket.datetime")
async def test_submit_bracket_success(mock_dt):
    mock_dt.now.return_value = _NOW
    mock_dt.timezone = timezone

    user = _user()
    lock_time = datetime(2026, 6, 11, 21, 0, 0, tzinfo=timezone.utc)
    
    # Mocks needed:
    # 1. get_current_user -> user
    # 2. reset_at query -> None
    # 3. existing_bracket query -> None
    # 4. bracket_full query (after save) -> BracketPrediction mock
    bracket_mock = MagicMock(spec=BracketPrediction)
    bracket_mock.id = 101
    bracket_mock.user_id = 1
    bracket_mock.tournament_id = 1
    bracket_mock.is_locked = False
    bracket_mock.total_points = 0
    bracket_mock.submitted_at = _NOW
    bracket_mock.updated_at = _NOW
    bracket_mock.group_picks = []
    bracket_mock.ko_picks = []
    bracket_mock.points_breakdown = {
        "groups": {},
        "ko_stages": {},
        "ko_stage_details": [],
    }

    session = _db_mock(user, None, None, bracket_mock)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    with patch("api.v1.bracket.resolve_tournament_id", AsyncMock(return_value=1)), \
         patch("api.v1.bracket.resolve_bracket_lock_time", AsyncMock(return_value=lock_time)):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(
                    "/api/v1/bracket",
                    json={"group_picks": [], "ko_picks": []},
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert r.status_code == 200
        finally:
            app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.bracket.datetime")
async def test_submit_bracket_after_lock_fails(mock_dt):
    # Current time: 22:00, locked at 21:00
    mock_dt.now.return_value = datetime(2026, 6, 11, 22, 0, 0, tzinfo=timezone.utc)
    mock_dt.timezone = timezone

    user = _user()
    lock_time = datetime(2026, 6, 11, 21, 0, 0, tzinfo=timezone.utc)
    
    session = _db_mock(user)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    with patch("api.v1.bracket.resolve_tournament_id", AsyncMock(return_value=1)), \
         patch("api.v1.bracket.resolve_bracket_lock_time", AsyncMock(return_value=lock_time)):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(
                    "/api/v1/bracket",
                    json={"group_picks": [], "ko_picks": []},
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert r.status_code == 423
            assert "locked" in r.json()["detail"].lower()
        finally:
            app.dependency_overrides.pop(get_db, None)


# ── Invitation Claim / Expire / Revoke ───────────────────────────────────────

@pytest.mark.asyncio
@patch("api.v1.auth.datetime")
async def test_register_expired_invitation(mock_dt):
    mock_dt.now.return_value = _NOW
    mock_dt.timezone = timezone

    invite = MagicMock(spec=Invitation)
    invite.expires_at = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc) # expired
    invite.is_revoked = False
    
    # 1. Find invitation -> invite
    session = _db_mock(invite)
    app.dependency_overrides[get_db] = lambda: session

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "new@example.com",
                "password": "password123",
                "display_name": "New User",
                "team_name": "Test Team",
                "invite_token": "expired-token",
            })
        assert r.status_code == 400
        assert "invalid" in r.json()["detail"].lower() or "expired" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.auth.datetime")
async def test_register_revoked_invitation(mock_dt):
    mock_dt.now.return_value = _NOW
    mock_dt.timezone = timezone

    # A revoked invitation will not be returned by the SQL query due to `is_revoked == False` clause.
    # So both new invitation check and fallback check return None.
    session = _db_mock(None, None)
    app.dependency_overrides[get_db] = lambda: session

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "new@example.com",
                "password": "password123",
                "display_name": "New User",
                "team_name": "Test Team",
                "invite_token": "revoked-token",
            })
        assert r.status_code == 400
        assert "invalid" in r.json()["detail"].lower() or "revoked" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Admin resets ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_reset_predictions():
    admin = _admin()
    tourney = _tournament()
    
    # Mock admin checks:
    # 1. get_current_user -> admin
    # 2. select(Tournament) -> tourney
    # 3. _deduct_and_delete_ledger user_ids query -> []
    # 4. fixture_ids query -> []
    # 5. bracket_ids_res query -> []
    session = _db_mock(admin, tourney, [], [], [])
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/admin/tournaments/1/reset/predictions",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
    finally:
        app.dependency_overrides.pop(get_db, None)
