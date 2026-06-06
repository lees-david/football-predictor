"""
Integration tests for services/scoring.py::score_ko_stage.

Tests the async DB orchestration layer — idempotency guard, per-user grading,
ledger entries, points accumulation, and the finals-weekend branch — using a
mock AsyncSession so no real database or Redis is needed.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from models.bracket_ko_pick import KoRound
from models.fixture import Fixture, FixtureStage, FixtureStatus
from models.user_points_ledger import PointsSourceType
from services.scoring import score_ko_stage


# ── test-data builders ────────────────────────────────────────────────────────

def _fixture(stage, home, away, hs, as_, status=FixtureStatus.completed):
    f = MagicMock(spec=Fixture)
    f.stage = stage
    f.home_team = home
    f.away_team = away
    f.home_score = hs
    f.away_score = as_
    f.status = status
    f.tournament_id = 1
    f.knockout_winner = None
    return f


def _bracket(id_, user_id):
    b = SimpleNamespace(id=id_, user_id=user_id, tournament_id=1, total_points=0)
    return b


def _pick(bracket_id, round_, team, slot="X-1"):
    return SimpleNamespace(bracket_id=bracket_id, round=round_, predicted_team=team, slot=slot)


def _user(id_, pts=0):
    u = MagicMock()
    u.id = id_
    u.total_points = pts
    return u


def _member(user_id, league_id):
    return SimpleNamespace(user_id=user_id, league_id=league_id)


def _db(*seq):
    """AsyncSession whose execute() calls return values in order.

    Each item in seq should be a list (→ .scalars().all()) or a scalar
    (→ .scalar_one_or_none() / .scalar_one()).
    """
    session = AsyncMock()
    it = iter(seq)

    async def _exec(_stmt):
        val = next(it, [])
        result = MagicMock()
        scalars = MagicMock()
        scalars.all.return_value = val if isinstance(val, list) else [val]
        result.scalars.return_value = scalars
        scalar_val = val if not isinstance(val, list) else None
        result.scalar_one_or_none.return_value = scalar_val
        result.scalar_one.return_value = scalar_val
        return result

    session.execute = _exec
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    return session


# ── idempotency guard ─────────────────────────────────────────────────────────

async def test_already_graded_skips_all_work():
    """If the Redis guard key exists, score_ko_stage returns immediately."""
    db = AsyncMock()

    with patch("core.redis_client.redis_client") as mock_redis:
        mock_redis.get = AsyncMock(return_value=b"1")  # already graded

        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.round_16)

    db.execute.assert_not_called()
    db.commit.assert_not_called()


# ── stage not fully completed ─────────────────────────────────────────────────

async def test_returns_early_when_stage_not_complete():
    """If any fixture in the stage is not completed, no grading happens."""
    pending = _fixture(FixtureStage.round_16, "BRA", "ARG", None, None, FixtureStatus.scheduled)
    done = _fixture(FixtureStage.round_16, "FRA", "GER", 1, 0)
    db = _db([pending, done])  # first execute returns all fixtures

    with patch("core.redis_client.redis_client") as mock_redis:
        mock_redis.get = AsyncMock(return_value=None)
        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.round_16)

    db.commit.assert_not_called()


# ── no brackets ───────────────────────────────────────────────────────────────

async def test_no_brackets_sets_guard_and_returns():
    """When there are no bracket predictions, the guard key is written and we return."""
    fixture = _fixture(FixtureStage.round_16, "BRA", "ARG", 2, 0)
    db = _db(
        [fixture],   # all fixtures
        [],          # no brackets
    )

    with patch("core.redis_client.redis_client") as mock_redis:
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()
        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.round_16)

    mock_redis.set.assert_awaited_once()
    db.commit.assert_not_called()


# ── regular KO round — round_16 ───────────────────────────────────────────────

async def test_grades_round_16_correctly():
    """
    Scenario: one user predicted BRA and FRA for round_16 (both correct).
    QF picks are NOT scored at R16 time — they are scored when QF fixtures complete.

    R16 pts: 2 teams × 5 = 10
    Total: 10
    """
    f_r16_a = _fixture(FixtureStage.round_16, "BRA", "ARG", 2, 0)  # BRA wins
    f_r16_b = _fixture(FixtureStage.round_16, "FRA", "GER", 1, 0)  # FRA wins

    bracket = _bracket(id_=10, user_id=99)
    picks = [
        _pick(10, KoRound.round_16, "BRA"),
        _pick(10, KoRound.round_16, "FRA"),
        _pick(10, KoRound.quarter_final, "BRA"),  # scored later, at QF completion
    ]
    user = _user(id_=99, pts=0)
    member = _member(user_id=99, league_id=7)

    db = _db(
        [f_r16_a, f_r16_b],   # all fixtures
        [bracket],             # brackets
        picks,                 # ko picks
        [user],                # users
        10,                    # SELECT SUM ledger recompute → 10 pts
        [member],              # league memberships (post-commit)
    )

    with patch("core.redis_client.redis_client") as mock_redis, \
         patch("services.scoring.update_user_score", new_callable=AsyncMock) as mock_update, \
         patch("services.scoring.snapshot_league_ranks", new_callable=AsyncMock):
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.round_16)

    assert user.total_points == 10
    assert bracket.total_points == 10
    db.add.assert_called_once()  # one ledger entry
    db.commit.assert_awaited_once()
    mock_redis.set.assert_awaited_once()
    mock_update.assert_awaited_once_with(7, 99, 10)


async def test_zero_points_no_ledger_entry():
    """User predicted wrong teams — 0 pts → no ledger row written."""
    f_r16 = _fixture(FixtureStage.round_16, "BRA", "ARG", 2, 0)

    bracket = _bracket(id_=10, user_id=99)
    picks = [
        _pick(10, KoRound.round_16, "GER"),  # wrong
        _pick(10, KoRound.quarter_final, "ESP"),  # wrong advancer
    ]
    user = _user(id_=99, pts=5)  # pre-existing points
    member = _member(user_id=99, league_id=7)

    db = _db([f_r16], [bracket], picks, [user], [member])

    with patch("core.redis_client.redis_client") as mock_redis, \
         patch("services.scoring.update_user_score", new_callable=AsyncMock), \
         patch("services.scoring.snapshot_league_ranks", new_callable=AsyncMock):
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.round_16)

    assert user.total_points == 5   # unchanged
    db.add.assert_not_called()      # no ledger entry


# ── finals weekend ────────────────────────────────────────────────────────────

async def test_finals_weekend_perfect_pick():
    """
    Perfect pick: champion BRA, runner-up FRA, 3rd ARG.
    grade_finals_weekend should award 20 + 8 = 28 pts.
    """
    f_final = _fixture(FixtureStage.final, "BRA", "FRA", 2, 1)
    f_third = _fixture(FixtureStage.third_place, "ARG", "ENG", 1, 0)
    # Also include an irrelevant earlier fixture so the stage guard passes
    f_sf1 = _fixture(FixtureStage.semi_final, "BRA", "GER", 1, 0)
    f_sf2 = _fixture(FixtureStage.semi_final, "FRA", "ARG", 2, 0)

    bracket = _bracket(id_=10, user_id=99)
    picks = [
        _pick(10, KoRound.final, "BRA"),
        _pick(10, KoRound.semi_final, "BRA"),
        _pick(10, KoRound.semi_final, "FRA"),
        _pick(10, KoRound.third_place, "ARG"),
    ]
    user = _user(id_=99, pts=0)
    member = _member(user_id=99, league_id=7)

    db = _db(
        [f_final, f_third, f_sf1, f_sf2],  # all fixtures
        [bracket],
        picks,
        [user],
        28,                                 # SELECT SUM ledger recompute → 28 pts
        [member],
    )

    with patch("core.redis_client.redis_client") as mock_redis, \
         patch("services.scoring.update_user_score", new_callable=AsyncMock), \
         patch("services.scoring.snapshot_league_ranks", new_callable=AsyncMock):
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.final)

    assert user.total_points == 28
    assert bracket.total_points == 28
    db.add.assert_called_once()


async def test_finals_weekend_no_points_no_ledger():
    """Completely wrong finals picks → 0 pts, no ledger entry."""
    f_final = _fixture(FixtureStage.final, "BRA", "FRA", 2, 1)

    bracket = _bracket(id_=10, user_id=99)
    picks = [
        _pick(10, KoRound.final, "GER"),
        _pick(10, KoRound.semi_final, "GER"),
        _pick(10, KoRound.semi_final, "ESP"),
    ]
    user = _user(id_=99, pts=10)

    db = _db([f_final], [bracket], picks, [user], [])

    with patch("core.redis_client.redis_client") as mock_redis, \
         patch("services.scoring.update_user_score", new_callable=AsyncMock), \
         patch("services.scoring.snapshot_league_ranks", new_callable=AsyncMock):
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        await score_ko_stage(db, tournament_id=1, completed_stage=FixtureStage.final)

    assert user.total_points == 10
    db.add.assert_not_called()


# ── guard key format ──────────────────────────────────────────────────────────

async def test_guard_key_written_after_grading():
    """The Redis guard key must be set after commit so re-runs are skipped."""
    f = _fixture(FixtureStage.quarter_final, "BRA", "ARG", 1, 0)
    db = _db([f], [], )  # no brackets → early return path after guard check

    with patch("core.redis_client.redis_client") as mock_redis, \
         patch("services.scoring.update_user_score", new_callable=AsyncMock), \
         patch("services.scoring.snapshot_league_ranks", new_callable=AsyncMock):
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        await score_ko_stage(db, tournament_id=5, completed_stage=FixtureStage.quarter_final)

    expected_key = "grading:ko:5:quarter_final:graded"
    mock_redis.set.assert_awaited_once_with(expected_key, "1")
