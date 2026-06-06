from services.points_engine import grade_match_prediction, grade_group_bracket
from models.fixture import FixtureStage

def test_grade_match_prediction_exact():
    assert grade_match_prediction(2, 1, 2, 1, FixtureStage.group) == 5

def test_grade_match_prediction_goal_diff():
    assert grade_match_prediction(3, 1, 2, 0, FixtureStage.group) == 3

def test_grade_match_prediction_outcome():
    assert grade_match_prediction(1, 0, 3, 1, FixtureStage.group) == 2
    # 1-1 vs 2-2: same goal diff (0) → 3 pts, not 2
    assert grade_match_prediction(1, 1, 2, 2, FixtureStage.group) == 3
    
def test_grade_match_prediction_loss():
    assert grade_match_prediction(1, 2, 2, 1, FixtureStage.group) == 0

def test_grade_match_prediction_knockout_winner_sign():
    stage = FixtureStage.round_16
    # Game ended 1-1 AET, home won on pens (knockout_winner_sign=+1)
    # Predict 3-2 home win → correct winner → 2 pts
    assert grade_match_prediction(3, 2, 1, 1, stage, knockout_winner_sign=1) == 2
    # Predict 1-2 away win → wrong winner → 0 pts
    assert grade_match_prediction(1, 2, 1, 1, stage, knockout_winner_sign=1) == 0
    # Away won on pens (sign=-1), predict 0-1 away win → 2 pts
    assert grade_match_prediction(0, 1, 1, 1, stage, knockout_winner_sign=-1) == 2
    # Predicting the exact AET score (1-1) still awards 5 pts — exact match takes priority
    assert grade_match_prediction(1, 1, 1, 1, stage, knockout_winner_sign=1) == 5
    assert grade_match_prediction(2, 0, 2, 0, stage, knockout_winner_sign=1) == 5

def test_grade_group_bracket_sweep():
    preds = {"BRA": 1, "SUI": 2, "CMR": 3, "SRB": 4}
    actual = {"BRA": 1, "SUI": 2, "CMR": 3, "SRB": 4}
    
    # 4 teams exact (4*5 = 20) + 10 point sweep bonus = 30
    assert grade_group_bracket(preds, actual) == 30
    
def test_grade_group_bracket_partial():
    preds = {"BRA": 2, "SUI": 1, "CMR": 4, "SRB": 3}
    actual = {"BRA": 1, "SUI": 2, "CMR": 3, "SRB": 4}
    
    # 0 exact, but BRA and SUI both predicted <= 2 and actual <= 2
    # So 2 pts each = 4 pts
    assert grade_group_bracket(preds, actual) == 4
