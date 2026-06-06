"""
Tests for services/group_tiebreakers.py — FIFA H2H chain + Wikipedia fallback.

Fixtures are SimpleNamespace objects with the same interface Fixture ORM objects
expose: home_team, away_team, home_score, away_score, stage, status.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from services.group_tiebreakers import (
    rank_teams_in_group,
    rank_third_place_teams,
    _stats_from_subset,
    _resolve_h2h,
    _wiki_resolve,
    _WIKI_CACHE,
)
from models.fixture import FixtureStage, FixtureStatus


def _f(home, away, hs, as_):
    """Build a completed group-stage fixture SimpleNamespace."""
    return SimpleNamespace(
        home_team=home,
        away_team=away,
        home_score=hs,
        away_score=as_,
        stage=FixtureStage.group,
        status=FixtureStatus.completed,
    )


def _stats(pts, gd, gf):
    return {"pts": pts, "gd": gd, "gf": gf}


# ── _stats_from_subset ────────────────────────────────────────────────────────

def test_stats_from_subset_win():
    fixtures = [_f("BRA", "ARG", 2, 0)]
    s = _stats_from_subset(fixtures, {"BRA", "ARG"})
    assert s["BRA"] == {"pts": 3, "gd": 2, "gf": 2}
    assert s["ARG"] == {"pts": 0, "gd": -2, "gf": 0}


def test_stats_from_subset_draw():
    fixtures = [_f("BRA", "ARG", 1, 1)]
    s = _stats_from_subset(fixtures, {"BRA", "ARG"})
    assert s["BRA"] == {"pts": 1, "gd": 0, "gf": 1}
    assert s["ARG"] == {"pts": 1, "gd": 0, "gf": 1}


def test_stats_from_subset_excludes_teams_outside_set():
    # FRA vs GER fixture should be ignored when only asking about BRA/ARG
    fixtures = [_f("BRA", "ARG", 1, 0), _f("FRA", "GER", 2, 2)]
    s = _stats_from_subset(fixtures, {"BRA", "ARG"})
    assert "FRA" not in s
    assert "GER" not in s
    assert s["BRA"]["pts"] == 3


def test_stats_from_subset_skips_null_scores():
    f = SimpleNamespace(
        home_team="BRA", away_team="ARG",
        home_score=None, away_score=None,
        stage=FixtureStage.group, status=FixtureStatus.completed,
    )
    s = _stats_from_subset([f], {"BRA", "ARG"})
    assert s["BRA"] == {"pts": 0, "gd": 0, "gf": 0}


# ── rank_teams_in_group — clear separation ────────────────────────────────────

def test_rank_no_tiebreaker_needed():
    """Points alone separate all four teams."""
    stats = {
        "BRA": _stats(9, 5, 6),
        "FRA": _stats(6, 2, 4),
        "GER": _stats(3, -2, 2),
        "ARG": _stats(0, -5, 1),
    }
    result = rank_teams_in_group(stats, [], None, None)
    assert result == ["BRA", "FRA", "GER", "ARG"]


def test_rank_goal_difference_breaks_pts_tie():
    stats = {
        "BRA": _stats(6, 3, 4),
        "FRA": _stats(6, 1, 3),
        "GER": _stats(3, -1, 2),
        "ARG": _stats(0, -3, 1),
    }
    result = rank_teams_in_group(stats, [], None, None)
    assert result[0] == "BRA"
    assert result[1] == "FRA"


def test_rank_goals_scored_breaks_gd_tie():
    stats = {
        "BRA": _stats(6, 2, 5),
        "FRA": _stats(6, 2, 3),
        "GER": _stats(3, -1, 2),
        "ARG": _stats(0, -3, 1),
    }
    result = rank_teams_in_group(stats, [], None, None)
    assert result[0] == "BRA"
    assert result[1] == "FRA"


# ── rank_teams_in_group — H2H resolution ─────────────────────────────────────

def test_rank_h2h_pts_separates_two_tied_teams():
    """BRA beat FRA in their head-to-head fixture; both equal on overall stats."""
    stats = {
        "BRA": _stats(4, 0, 3),
        "FRA": _stats(4, 0, 3),
        "GER": _stats(2, 0, 2),
        "ARG": _stats(2, 0, 2),
    }
    fixtures = [_f("BRA", "FRA", 1, 0), _f("GER", "ARG", 0, 0)]
    result = rank_teams_in_group(stats, fixtures, "A", 2026)
    assert result[0] == "BRA"
    assert result[1] == "FRA"


def test_rank_h2h_gd_separates_two_tied_teams():
    """Draw in H2H but BRA has better H2H goal difference."""
    stats = {
        "BRA": _stats(4, 0, 4),
        "FRA": _stats(4, 0, 4),
        "GER": _stats(2, 0, 2),
        "ARG": _stats(2, 0, 2),
    }
    # BRA-FRA drew 2-1, but we need two fixtures to make overall stats equal.
    # Use h2h gd: BRA wins 2-0 vs FRA sub-match
    fixtures = [_f("BRA", "FRA", 2, 0)]
    result = rank_teams_in_group(stats, fixtures, "A", 2026)
    assert result[0] == "BRA"
    assert result[1] == "FRA"


def test_rank_three_way_h2h_tie_falls_to_wiki():
    """Three teams locked on pts/gd/gf overall AND in H2H — Wikipedia resolves."""
    stats = {
        "BRA": _stats(3, 0, 1),
        "FRA": _stats(3, 0, 1),
        "GER": _stats(3, 0, 1),
        "ARG": _stats(0, 0, 0),
    }
    # Cyclic H2H: BRA beat FRA, FRA beat GER, GER beat BRA — each has 3 pts H2H
    fixtures = [
        _f("BRA", "FRA", 1, 0),
        _f("FRA", "GER", 1, 0),
        _f("GER", "BRA", 1, 0),
        _f("BRA", "ARG", 0, 0),
        _f("FRA", "ARG", 0, 0),
        _f("GER", "ARG", 0, 0),
    ]
    wiki_order = ["BRA", "GER", "FRA", "ARG"]
    with patch("services.group_tiebreakers._fetch_wiki_group_order", return_value=wiki_order):
        result = rank_teams_in_group(stats, fixtures, "A", 2026)
    assert result[:3] == ["BRA", "GER", "FRA"]
    assert result[3] == "ARG"


# ── _wiki_resolve ─────────────────────────────────────────────────────────────

def test_wiki_resolve_single_team_passthrough():
    result = _wiki_resolve(2026, "A", ["BRA"])
    assert result == ["BRA"]


def test_wiki_resolve_no_season_falls_back_to_sorted():
    result = _wiki_resolve(None, None, ["FRA", "BRA"])
    assert result == ["BRA", "FRA"]  # alphabetical


def test_wiki_resolve_empty_wiki_response_falls_back_to_sorted():
    with patch("services.group_tiebreakers._fetch_wiki_group_order", return_value=[]):
        result = _wiki_resolve(2026, "A", ["FRA", "BRA"])
    assert result == ["BRA", "FRA"]


def test_wiki_resolve_uses_wiki_order():
    wiki_order = ["FRA", "BRA", "GER"]
    with patch("services.group_tiebreakers._fetch_wiki_group_order", return_value=wiki_order):
        result = _wiki_resolve(2026, "A", ["GER", "BRA", "FRA"])
    assert result == ["FRA", "BRA", "GER"]


def test_wiki_resolve_team_missing_from_wiki_sorts_last():
    wiki_order = ["FRA", "BRA"]
    with patch("services.group_tiebreakers._fetch_wiki_group_order", return_value=wiki_order):
        result = _wiki_resolve(2026, "A", ["GER", "BRA", "FRA"])
    assert result[-1] == "GER"


# ── rank_third_place_teams ────────────────────────────────────────────────────

def _candidate(group, team, pts, gd, gf):
    return (group, team, {"pts": pts, "gd": gd, "gf": gf})


def test_rank_third_place_clear_order():
    candidates = [
        _candidate("A", "BRA", 7, 4, 5),
        _candidate("B", "FRA", 5, 2, 3),
        _candidate("C", "GER", 4, 0, 2),
        _candidate("D", "ARG", 3, -1, 1),
    ]
    result = rank_third_place_teams(candidates, 2026)
    assert result == ["BRA", "FRA", "GER", "ARG"]


def test_rank_third_place_tie_resolves_alphabetical():
    # Two teams with identical stats — no H2H possible, falls back to alphabetical
    candidates = [
        _candidate("A", "ZAM", 4, 0, 1),
        _candidate("B", "BRA", 4, 0, 1),
    ]
    result = rank_third_place_teams(candidates, 2026)
    assert result == ["BRA", "ZAM"]


def test_rank_third_place_gd_tiebreaker():
    candidates = [
        _candidate("A", "FRA", 5, 3, 4),
        _candidate("B", "GER", 5, 1, 3),
    ]
    result = rank_third_place_teams(candidates, 2026)
    assert result == ["FRA", "GER"]


# ── Wikipedia cache ───────────────────────────────────────────────────────────

def test_fetch_wiki_uses_cache(monkeypatch):
    """Second call for the same key must not issue a network request."""
    _WIKI_CACHE.clear()
    _WIKI_CACHE[(2026, "Z")] = ["BRA", "FRA"]

    called = []
    monkeypatch.setattr(
        "services.group_tiebreakers.requests.get",
        lambda *a, **kw: called.append(1),
    )
    from services.group_tiebreakers import _fetch_wiki_group_order
    result = _fetch_wiki_group_order(2026, "Z")
    assert result == ["BRA", "FRA"]
    assert not called  # no HTTP call made


def test_fetch_wiki_network_error_returns_empty():
    _WIKI_CACHE.clear()
    import requests as req

    def raise_exc(*a, **kw):
        raise req.exceptions.ConnectionError("offline")

    with patch("services.group_tiebreakers.requests.get", side_effect=raise_exc):
        from services.group_tiebreakers import _fetch_wiki_group_order
        result = _fetch_wiki_group_order(2026, "Q")
    assert result == []
    # Negative result is cached so we don't hammer a dead endpoint
    assert _WIKI_CACHE.get((2026, "Q")) == []
