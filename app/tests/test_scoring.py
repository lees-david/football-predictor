from types import SimpleNamespace

from services.scoring import grade_ko_round, grade_finals_weekend, ROUND_POINTS
from models.bracket_ko_pick import KoRound
from models.fixture import FixtureStatus, FixtureStage


# ── grade_ko_round ────────────────────────────────────────────────────────────

def test_ko_round_full_match():
    predicted = {"BRA", "FRA", "GER", "ESP"}
    actual = {"BRA", "FRA", "GER", "ESP"}
    pts, matched = grade_ko_round(predicted, actual, KoRound.round_16)
    assert pts == 4 * ROUND_POINTS[KoRound.round_16]  # 4 * 5 = 20
    assert matched == predicted


def test_ko_round_partial_match():
    predicted = {"BRA", "FRA", "GER", "ESP"}
    actual = {"BRA", "FRA", "ARG", "ENG"}
    pts, matched = grade_ko_round(predicted, actual, KoRound.quarter_final)
    assert pts == 2 * ROUND_POINTS[KoRound.quarter_final]  # 2 * 8 = 16
    assert matched == {"BRA", "FRA"}


def test_ko_round_no_match():
    predicted = {"BRA", "FRA"}
    actual = {"GER", "ESP"}
    pts, matched = grade_ko_round(predicted, actual, KoRound.semi_final)
    assert pts == 0
    assert matched == set()


def test_ko_round_empty_predictions():
    pts, matched = grade_ko_round(set(), {"BRA", "FRA"}, KoRound.round_16)
    assert pts == 0
    assert matched == set()


def test_ko_round_points_scale_by_round():
    predicted = {"BRA"}
    actual = {"BRA"}
    assert grade_ko_round(predicted, actual, KoRound.round_32)[0] == 3
    assert grade_ko_round(predicted, actual, KoRound.round_16)[0] == 5
    assert grade_ko_round(predicted, actual, KoRound.quarter_final)[0] == 8
    assert grade_ko_round(predicted, actual, KoRound.semi_final)[0] == 12


# ── grade_finals_weekend ─────────────────────────────────────────────────────

def _make_pick(round_: KoRound, team: str):
    return SimpleNamespace(round=round_, predicted_team=team, slot="F-1")


def _make_fixture(stage: FixtureStage, home: str, away: str, home_score: int, away_score: int):
    return SimpleNamespace(
        stage=stage,
        home_team=home,
        away_team=away,
        home_score=home_score,
        away_score=away_score,
        status=FixtureStatus.completed,
        knockout_winner=None,
    )


def test_finals_perfect_pick():
    # Predicted: BRA wins final, FRA is runner-up; ARG wins 3rd place
    picks = [
        _make_pick(KoRound.final, "BRA"),
        _make_pick(KoRound.semi_final, "BRA"),
        _make_pick(KoRound.semi_final, "FRA"),
        _make_pick(KoRound.third_place, "ARG"),
    ]
    fixtures = [
        _make_fixture(FixtureStage.final, "BRA", "FRA", 2, 1),
        _make_fixture(FixtureStage.third_place, "ARG", "ENG", 2, 0),
    ]
    pts = grade_finals_weekend(picks, fixtures)
    assert pts == 28  # 20 (perfect) + 8 (3rd place)


def test_finals_inverse_pick():
    # Predicted: FRA wins, BRA runner-up — actual BRA wins, FRA runner-up
    picks = [
        _make_pick(KoRound.final, "FRA"),
        _make_pick(KoRound.semi_final, "FRA"),
        _make_pick(KoRound.semi_final, "BRA"),
    ]
    fixtures = [
        _make_fixture(FixtureStage.final, "BRA", "FRA", 1, 0),
    ]
    pts = grade_finals_weekend(picks, fixtures)
    assert pts == 10


def test_finals_only_third_place_correct():
    picks = [
        _make_pick(KoRound.final, "GER"),
        _make_pick(KoRound.semi_final, "GER"),
        _make_pick(KoRound.semi_final, "ESP"),
        _make_pick(KoRound.third_place, "ARG"),
    ]
    fixtures = [
        _make_fixture(FixtureStage.final, "BRA", "FRA", 2, 1),
        _make_fixture(FixtureStage.third_place, "ARG", "ENG", 1, 0),
    ]
    pts = grade_finals_weekend(picks, fixtures)
    assert pts == 8


def test_finals_no_points():
    picks = [
        _make_pick(KoRound.final, "GER"),
        _make_pick(KoRound.semi_final, "GER"),
        _make_pick(KoRound.semi_final, "ESP"),
        _make_pick(KoRound.third_place, "ENG"),
    ]
    fixtures = [
        _make_fixture(FixtureStage.final, "BRA", "FRA", 2, 1),
        _make_fixture(FixtureStage.third_place, "ARG", "ENG", 1, 0),
    ]
    pts = grade_finals_weekend(picks, fixtures)
    assert pts == 0


def test_finals_champion_correct_runner_up_wrong():
    # Champion correct but runner-up is wrong — not perfect pick, not inverse
    picks = [
        _make_pick(KoRound.final, "BRA"),
        _make_pick(KoRound.semi_final, "BRA"),
        _make_pick(KoRound.semi_final, "GER"),  # wrong runner-up
    ]
    fixtures = [
        _make_fixture(FixtureStage.final, "BRA", "FRA", 2, 1),
    ]
    pts = grade_finals_weekend(picks, fixtures)
    assert pts == 0
