from models.fixture import FixtureStage

def grade_match_prediction(
    pred_home: int,
    pred_away: int,
    actual_home: int,
    actual_away: int,
    stage: FixtureStage,
    knockout_winner_sign: int | None = None,
) -> int:
    """
    Given: predicted_home, predicted_away, actual_home, actual_away, stage, knockout_winner_sign

    knockout_winner_sign is +1 if the home team progressed, -1 if the away team progressed.
    Only set for KO fixtures settled by AET or penalties where the score alone is ambiguous
    (e.g. 1-1 AET, home won 4-2 on pens → knockout_winner_sign = +1).
    When set it overrides the score-derived sign for the outcome tier only.

    1. Exact score check:
       IF predicted_home == actual_home AND predicted_away == actual_away → 5 pts

    2. Correct goal difference/margin:
       ELIF (predicted_home - predicted_away) == (actual_home - actual_away) → 3 pts
       [Note: this implicitly captures correct outcome on draws; score exactly 3, not 2+3]

    3. Correct outcome only (W/D/L direction, wrong margin):
       actual_sign = knockout_winner_sign if set, else SIGN(actual_home - actual_away)
       ELIF SIGN(pred) == actual_sign → 2 pts
       (e.g. predict 3-2 home win; game was 1-1 AET, home won on pens → knockout_winner_sign=+1 → 2 pts)

    4. All others → 0 pts
    """
    if pred_home == actual_home and pred_away == actual_away:
        return 5

    if (pred_home - pred_away) == (actual_home - actual_away):
        return 3

    pred_sign = (pred_home > pred_away) - (pred_home < pred_away)
    actual_sign = knockout_winner_sign if knockout_winner_sign is not None \
        else (actual_home > actual_away) - (actual_home < actual_away)

    if pred_sign == actual_sign:
        return 2

    return 0

def grade_group_bracket(user_group_picks: dict[str, int], actual_standings: dict[str, int]) -> int:
    """
    Given: user's bracket_group_picks for group_code G (team -> pos), actual_final_standings[G] (team -> pos)

    Per team in group (4 iterations):
      actual_pos  = actual_final_standings[team]
      pred_pos    = user_group_picks[team]

      IF pred_pos == actual_pos          → 5 pts
      ELIF actual_pos <= 2 AND pred_pos <= 2  → 2 pts  (qualified, wrong order)
      ELSE                               → 0 pts

    Perfect Group Sweep bonus:
      IF all 4 teams predicted in exact order (positions 1–4 all correct) → +10 pts lump sum
    """
    total = 0
    correct_exact = 0
    
    for team, pred_pos in user_group_picks.items():
        actual_pos = actual_standings.get(team)
        if actual_pos is None:
            continue
            
        if pred_pos == actual_pos:
            total += 5
            correct_exact += 1
        elif actual_pos <= 2 and pred_pos <= 2:
            total += 2
            
    if correct_exact == 4:
        total += 10
        
    return total
