import pytest
from pydantic import ValidationError
from schemas.bracket import BracketGroupPickCreate, BracketKoPickCreate, BracketPredictionCreate
from models.bracket_ko_pick import KoRound


# ── BracketGroupPickCreate validation ────────────────────────────────────────

def test_group_pick_valid():
    pick = BracketGroupPickCreate(group_code="A", position=1, predicted_team="BRA")
    assert pick.group_code == "A"
    assert pick.position == 1


def test_group_pick_position_below_min():
    with pytest.raises(ValidationError):
        BracketGroupPickCreate(group_code="A", position=0, predicted_team="BRA")


def test_group_pick_position_above_max():
    with pytest.raises(ValidationError):
        BracketGroupPickCreate(group_code="A", position=5, predicted_team="BRA")


def test_group_pick_group_code_too_long():
    with pytest.raises(ValidationError):
        BracketGroupPickCreate(group_code="AB", position=1, predicted_team="BRA")


def test_group_pick_all_valid_positions():
    for pos in range(1, 5):
        pick = BracketGroupPickCreate(group_code="B", position=pos, predicted_team="FRA")
        assert pick.position == pos


# ── BracketKoPickCreate validation ───────────────────────────────────────────

def test_ko_pick_valid():
    pick = BracketKoPickCreate(round=KoRound.quarter_final, slot="QF-1", predicted_team="GER")
    assert pick.round == KoRound.quarter_final


def test_ko_pick_invalid_round():
    with pytest.raises(ValidationError):
        BracketKoPickCreate(round="not_a_round", slot="QF-1", predicted_team="GER")


# ── BracketPredictionCreate validation ───────────────────────────────────────

def test_bracket_prediction_create_empty_picks():
    # Empty lists are valid — partial submissions are allowed
    payload = BracketPredictionCreate(group_picks=[], ko_picks=[])
    assert payload.group_picks == []
    assert payload.ko_picks == []


def test_bracket_prediction_create_full():
    group_picks = [
        BracketGroupPickCreate(group_code="A", position=i, predicted_team=f"TEAM{i}")
        for i in range(1, 5)
    ]
    ko_picks = [
        BracketKoPickCreate(round=KoRound.round_16, slot=f"R16-{i}", predicted_team=f"TEAM{i}")
        for i in range(1, 3)
    ]
    payload = BracketPredictionCreate(group_picks=group_picks, ko_picks=ko_picks)
    assert len(payload.group_picks) == 4
    assert len(payload.ko_picks) == 2
