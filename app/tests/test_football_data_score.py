from services.football_data import parse_score


# ── REGULAR duration ──────────────────────────────────────────────────────────

def test_regular_fulltime_only():
    """REGULAR: regularTime absent — fullTime is authoritative."""
    result = parse_score({
        "duration": "REGULAR",
        "winner": "HOME_TEAM",
        "fullTime": {"home": 3, "away": 1},
        "regularTime": None,
        "extraTime": None,
        "penalties": None,
    })
    assert result["home_score"] == 3
    assert result["away_score"] == 1
    assert result["home_score_aet"] is None
    assert result["away_score_aet"] is None
    assert result["home_pens"] is None
    assert result["away_pens"] is None
    assert result["match_duration"] == "REGULAR"
    assert result["winner"] == "HOME_TEAM"


def test_regular_with_regular_time_field():
    """REGULAR: regularTime present — prefer it over fullTime."""
    result = parse_score({
        "duration": "REGULAR",
        "winner": "AWAY_TEAM",
        "fullTime": {"home": 0, "away": 2},
        "regularTime": {"home": 0, "away": 2},
        "extraTime": None,
        "penalties": None,
    })
    assert result["home_score"] == 0
    assert result["away_score"] == 2
    assert result["home_score_aet"] is None


def test_regular_draw():
    result = parse_score({
        "duration": "REGULAR",
        "winner": "DRAW",
        "fullTime": {"home": 1, "away": 1},
        "regularTime": None,
        "extraTime": None,
        "penalties": None,
    })
    assert result["home_score"] == 1
    assert result["away_score"] == 1
    assert result["winner"] == "DRAW"


# ── EXTRA_TIME duration ───────────────────────────────────────────────────────

def test_extra_time_basic():
    """EXTRA_TIME: AET score = regularTime + extraTime (ET-only goals)."""
    result = parse_score({
        "duration": "EXTRA_TIME",
        "winner": "HOME_TEAM",
        "fullTime": {"home": 2, "away": 1},  # cumulative — NOT used for display
        "regularTime": {"home": 1, "away": 1},
        "extraTime": {"home": 1, "away": 0},
        "penalties": None,
    })
    assert result["home_score"] == 1      # 90-min display
    assert result["away_score"] == 1
    assert result["home_score_aet"] == 2  # 1 + 1 ET goal
    assert result["away_score_aet"] == 1  # 1 + 0 ET goals
    assert result["home_pens"] is None
    assert result["match_duration"] == "EXTRA_TIME"


def test_extra_time_zero_et_goals():
    """EXTRA_TIME with no goals in ET period — should still set AET score."""
    result = parse_score({
        "duration": "EXTRA_TIME",
        "winner": "AWAY_TEAM",
        "fullTime": {"home": 1, "away": 2},
        "regularTime": {"home": 1, "away": 1},
        "extraTime": {"home": 0, "away": 1},
        "penalties": None,
    })
    assert result["home_score"] == 1
    assert result["away_score"] == 1
    assert result["home_score_aet"] == 1   # 1 + 0
    assert result["away_score_aet"] == 2   # 1 + 1


# ── PENALTY_SHOOTOUT duration — the critical trap case ───────────────────────

def test_penalty_shootout_the_trap_case():
    """
    The key correctness test.

    Docs example: Germany EC 1996 QF — score was 1-1 AET, 6-5 on pens.
    API reports fullTime=7-6 (1+0+6, 1+0+5 — completely misleading).
    We must NOT use fullTime. Display: 1-1 AET, pens 6-5.
    """
    result = parse_score({
        "duration": "PENALTY_SHOOTOUT",
        "winner": "HOME_TEAM",
        "fullTime": {"homeTeam": 7, "awayTeam": 6},   # the misleading value
        "regularTime": {"homeTeam": 1, "awayTeam": 1},
        "extraTime": {"homeTeam": 0, "awayTeam": 0},
        "penalties": {"homeTeam": 6, "awayTeam": 5},
    })
    assert result["home_score"] == 1        # 90-min
    assert result["away_score"] == 1
    assert result["home_score_aet"] == 1    # 1 + 0 ET = still 1
    assert result["away_score_aet"] == 1    # 1 + 0 ET = still 1
    assert result["home_pens"] == 6
    assert result["away_pens"] == 5
    assert result["match_duration"] == "PENALTY_SHOOTOUT"
    # Crucially: fullTime (7, 6) was never used
    assert result["home_score"] != 7
    assert result["away_score"] != 6


def test_penalty_shootout_modern_key_names():
    """v4 API uses 'home'/'away' keys (not legacy 'homeTeam'/'awayTeam')."""
    result = parse_score({
        "duration": "PENALTY_SHOOTOUT",
        "winner": "AWAY_TEAM",
        "fullTime": {"home": 4, "away": 5},
        "regularTime": {"home": 0, "away": 0},
        "extraTime": {"home": 0, "away": 0},
        "penalties": {"home": 4, "away": 5},
    })
    assert result["home_score"] == 0
    assert result["away_score"] == 0
    assert result["home_pens"] == 4
    assert result["away_pens"] == 5
    assert result["winner"] == "AWAY_TEAM"


def test_penalty_shootout_et_goals_then_pens():
    """Uncommon: goals in ET, then goes to pens. AET should reflect ET goals."""
    result = parse_score({
        "duration": "PENALTY_SHOOTOUT",
        "winner": "HOME_TEAM",
        "fullTime": {"home": 6, "away": 5},  # 1+1+4 — misleading
        "regularTime": {"home": 1, "away": 1},
        "extraTime": {"home": 1, "away": 0},  # ET goal, but still went to pens
        "penalties": {"home": 4, "away": 4},  # tied — one team must have won (edge case in data)
    })
    assert result["home_score"] == 1       # 90-min
    assert result["away_score"] == 1
    assert result["home_score_aet"] == 2   # 1 + 1 ET goal
    assert result["away_score_aet"] == 1   # 1 + 0


# ── Defensive: missing / null fields ─────────────────────────────────────────

def test_missing_duration_defaults_to_regular():
    """No duration key → treated as REGULAR."""
    result = parse_score({
        "winner": "HOME_TEAM",
        "fullTime": {"home": 2, "away": 0},
    })
    assert result["home_score"] == 2
    assert result["match_duration"] == "REGULAR"


def test_null_score_values_propagate_as_none():
    """Unplayed / in-progress match — all scores should be None."""
    result = parse_score({
        "duration": "REGULAR",
        "winner": None,
        "fullTime": {"home": None, "away": None},
        "regularTime": None,
    })
    assert result["home_score"] is None
    assert result["away_score"] is None
    assert result["winner"] is None
