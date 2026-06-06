"""Tests for prediction locking logic on the match predictions API endpoint.

Covers:
- Submitting predictions before kickoff (succeeds)
- Buffer-time lockout (fails < 15 mins to kickoff)
- Kickoff time lockout (fails after kickoff)
- Modifying predictions that are already marked is_locked=True (fails)
- Stage-wide lock triggers (fails when first match in stage has kicked off)
"""

from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient, ASGITransport

from api.deps import get_db
from core.security import create_access_token
from main import app
from models.user import User, UserRole
from models.fixture import Fixture, FixtureStage
from models.match_prediction import MatchPrediction

_NOW = datetime(2026, 6, 11, 12, 0, 0, tzinfo=timezone.utc)


def _user():
    u = MagicMock(spec=User)
    u.id = 1
    u.email = "player@example.com"
    u.role = UserRole.player
    u.is_active = True
    return u


def _fixture(id_=10, stage=FixtureStage.group, kickoff=None):
    f = MagicMock(spec=Fixture)
    f.id = id_
    f.stage = stage
    f.tournament_id = 1
    f.kickoff_time = kickoff or datetime(2026, 6, 11, 14, 0, 0, tzinfo=timezone.utc)
    f.home_team = "BRA"
    f.away_team = "ARG"
    return f


def _prediction(id_=100, is_locked=False):
    p = MagicMock(spec=MatchPrediction)
    p.id = id_
    p.user_id = 1
    p.fixture_id = 10
    p.predicted_home = 2
    p.predicted_away = 1
    p.is_locked = is_locked
    return p


def _db_mock(*responses):
    """AsyncSession mock that yields responses in order for scalar_one_or_none / scalars."""
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

    async def _refresh(obj):
        if hasattr(obj, "id") and obj.id is None:
            obj.id = 100
        if hasattr(obj, "points_awarded") and obj.points_awarded is None:
            obj.points_awarded = 0
        if hasattr(obj, "is_locked") and obj.is_locked is None:
            obj.is_locked = False
        if hasattr(obj, "submitted_at") and getattr(obj, "submitted_at", None) is None:
            obj.submitted_at = _NOW
        if hasattr(obj, "updated_at") and getattr(obj, "updated_at", None) is None:
            obj.updated_at = _NOW

    session.execute = _exec
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = _refresh
    return session


@pytest.fixture(autouse=True)
def _no_redis():
    with patch("core.rate_limit.redis_client") as m:
        m.incr = AsyncMock(return_value=1)
        m.expire = AsyncMock()
        yield m


@pytest.mark.asyncio
@patch("api.v1.match_predictions.datetime")
async def test_submit_prediction_before_lock(mock_dt):
    # Current time: 12:00. Kickoff: 14:00. Lock window: 13:45.
    mock_dt.now.return_value = _NOW
    mock_dt.timezone = timezone

    user = _user()
    fixture = _fixture()
    # Sequence of DB queries:
    # 1. get_current_user -> user
    # 2. Fetch fixture -> fixture
    # 3. Fetch min kickoff (stage-wide lock check) -> 14:00
    # 4. Fetch existing prediction -> None (new prediction)
    session = _db_mock(user, fixture, datetime(2026, 6, 11, 14, 0, 0, tzinfo=timezone.utc), None)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/match-predictions",
                json={"fixture_id": 10, "predicted_home": 2, "predicted_away": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200
        session.add.assert_called_once()
        session.commit.assert_called_once()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.match_predictions.datetime")
async def test_submit_prediction_within_15_mins_fails(mock_dt):
    # Current time: 13:50 (kickoff is 14:00, within 15 mins lock window)
    mock_dt.now.return_value = datetime(2026, 6, 11, 13, 50, 0, tzinfo=timezone.utc)
    mock_dt.timezone = timezone

    user = _user()
    fixture = _fixture()
    # Sequence of DB queries:
    # 1. get_current_user -> user
    # 2. Fetch fixture -> fixture
    # 3. Fetch min kickoff (stage-wide lock check) -> 14:00
    session = _db_mock(user, fixture, datetime(2026, 6, 11, 14, 0, 0, tzinfo=timezone.utc))
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/match-predictions",
                json={"fixture_id": 10, "predicted_home": 2, "predicted_away": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 423
        assert "closed" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.match_predictions.datetime")
async def test_submit_prediction_after_kickoff_fails(mock_dt):
    # Current time: 14:05 (kickoff is 14:00)
    mock_dt.now.return_value = datetime(2026, 6, 11, 14, 5, 0, tzinfo=timezone.utc)
    mock_dt.timezone = timezone

    user = _user()
    fixture = _fixture()
    # Sequence:
    # 1. get_current_user -> user
    # 2. Fetch fixture -> fixture
    # 3. Fetch min kickoff -> 14:00
    session = _db_mock(user, fixture, datetime(2026, 6, 11, 14, 0, 0, tzinfo=timezone.utc))
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/match-predictions",
                json={"fixture_id": 10, "predicted_home": 2, "predicted_away": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 423
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.match_predictions.datetime")
async def test_submit_prediction_already_locked_record_fails(mock_dt):
    # Current time: 12:00. Kickoff: 14:00.
    mock_dt.now.return_value = _NOW
    mock_dt.timezone = timezone

    user = _user()
    fixture = _fixture()
    existing = _prediction(is_locked=True)
    # Sequence:
    # 1. get_current_user -> user
    # 2. Fetch fixture -> fixture
    # 3. Fetch min kickoff -> 14:00
    # 4. Fetch existing prediction -> returns existing which is locked
    session = _db_mock(user, fixture, datetime(2026, 6, 11, 14, 0, 0, tzinfo=timezone.utc), existing)
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/match-predictions",
                json={"fixture_id": 10, "predicted_home": 3, "predicted_away": 2},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 423
        assert "locked and cannot be changed" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@patch("api.v1.match_predictions.datetime")
async def test_stage_wide_lock_trigger(mock_dt):
    # Current time: 13:46. Kickoff of this match: 15:00.
    # But another match in the same stage starts at 13:45, triggering stage lock.
    mock_dt.now.return_value = datetime(2026, 6, 11, 13, 46, 0, tzinfo=timezone.utc)
    mock_dt.timezone = timezone

    user = _user()
    fixture = _fixture(kickoff=datetime(2026, 6, 11, 15, 0, 0, tzinfo=timezone.utc))
    # Sequence:
    # 1. get_current_user -> user
    # 2. Fetch fixture -> fixture
    # 3. Fetch min kickoff -> 13:45
    session = _db_mock(user, fixture, datetime(2026, 6, 11, 13, 45, 0, tzinfo=timezone.utc))
    app.dependency_overrides[get_db] = lambda: session
    token = create_access_token(subject=1)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(
                "/api/v1/match-predictions",
                json={"fixture_id": 10, "predicted_home": 1, "predicted_away": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 423
        assert "phase (group) is locked" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)
