from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient, ASGITransport

from api.deps import get_db
from core.security import create_access_token
from main import app
from models.user import User, UserRole
from models.tournament import Tournament
from models.fixture import Fixture, FixtureStage
from models.match_prediction import MatchPrediction
from models.bracket_prediction import BracketPrediction

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
    session.flush = AsyncMock()
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

@pytest.mark.asyncio
async def test_get_prediction_reset_status_success():
    admin = _admin()
    
    # We will mock the fixtures list returned from database
    fix_group = MagicMock(spec=Fixture)
    fix_group.stage = FixtureStage.group
    fix_group.kickoff_time = _NOW + timedelta(days=1)
    fix_group.home_team = "Argentina"
    fix_group.away_team = "Brazil"

    fix_r32 = MagicMock(spec=Fixture)
    fix_r32.stage = FixtureStage.round_32
    fix_r32.kickoff_time = _NOW + timedelta(days=5)
    fix_r32.home_team = "Winner Match 1"
    fix_r32.away_team = "Runner Up Match 2"

    fixtures = [fix_group, fix_r32]

    # Database responses:
    # 1. get_current_user -> admin
    # 2. select(Fixture) -> fixtures
    session = _db_mock(admin, fixtures)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    with patch("services.tournaments.resolve_bracket_lock_time", AsyncMock(return_value=_NOW + timedelta(hours=12))):
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get(
                    "/api/v1/admin/tournaments/1/reset/predictions/status",
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert r.status_code == 200
            data = r.json()
            assert data["pred_group_matches"] == "open"
            assert data["pred_group_standings"] == "open"
            assert data["pred_ko_bracket"] == "open"
            assert data["pred_r32_matches"] == "not_yet_opened" # because it contains placeholder teams
        finally:
            app.dependency_overrides.pop(get_db, None)

@pytest.mark.asyncio
async def test_reset_predictions_by_scope_matches():
    admin = _admin()
    tourney = _tournament()

    # Mocks needed:
    # 1. get_current_user -> admin
    # 2. select(Tournament) -> tourney
    # 3. select(Fixture.id) -> [10, 11]
    # 4. select(MatchPrediction.user_id) -> [1, 2]
    # 5. recompute_users_in_session inside routing -> mock
    session = _db_mock(admin, tourney, [10, 11], [1, 2])
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    with patch("workers.points_recalc.recompute_users_in_session", AsyncMock(return_value={})) as mock_recalc, \
         patch("api.v1.admin._resync_leaderboards", AsyncMock()) as mock_resync:
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(
                    "/api/v1/admin/tournaments/1/reset/predictions/pred_group_matches",
                    headers={"Authorization": f"Bearer {token}"},
                )
            assert r.status_code == 200
            assert r.json()["status"] == "ok"
            assert r.json()["affected_users"] == 2
            assert mock_recalc.called
            assert mock_resync.called
        finally:
            app.dependency_overrides.pop(get_db, None)
