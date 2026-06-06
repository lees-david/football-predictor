# Football Predictor — Scoring System

Complete rules for how user predictions are graded and points are awarded.

---

## 1. Match Prediction Scoring

For each fixture, a user predicts the exact score (`predicted_home` – `predicted_away`). When the fixture completes, the prediction is graded against the actual result:

| Tier | Condition | Points | Example |
|------|-----------|--------|---------|
| **Exact Score** | `pred_home == actual_home` AND `pred_away == actual_away` | **5** | Predict 2-1, result 2-1 |
| **Correct Margin** | `(pred_home - pred_away) == (actual_home - actual_away)` (but not exact score) | **3** | Predict 2-0, result 3-1 (both +2 margin) |
| **Correct Outcome** | Predicted the correct winner (or draw) — see KO note below | **2** | Predict 1-0, result 3-0 (both home win) |
| **Wrong** | Everything else | **0** | Predict 1-0, result 0-2 |

**Key detail**: Correct margin (3 pts) is checked BEFORE correct outcome (2 pts). A prediction that matches the exact goal difference but not the exact score gets 3 points, not 3+2.

### Knockout Stages: Extra Time & Penalties

For KO fixtures that are settled by AET or a penalty shootout, the `Fixture.knockout_winner` column records the team that actually progressed. When set, it overrides the score-derived sign for the **Correct Outcome** tier only — exact score and margin tiers always compare against the final reported score.

| Scenario | Prediction | Score (AET) | `knockout_winner` | Points |
|----------|-----------|-------------|-------------------|--------|
| Normal KO win | 3-2 home | 3-2 | NULL | **5** (exact) |
| AET win, correct side | 3-2 home | 2-1 | home_team | **2** (correct winner) |
| Pens win, correct side | 3-2 home | 1-1 AET | home_team | **2** (correct winner) |
| Pens win, wrong side | 1-2 away | 1-1 AET | home_team | **0** |

`knockout_winner` is set via the admin simulation endpoint (`POST /admin/simulate/fixture/{id}/result` with `knockout_winner` in the body). The Wikipedia scraper does not yet parse ET/pens outcomes automatically.

### Outcome Sign Logic
```
pred_sign   = (pred_home > pred_away) - (pred_home < pred_away)   // +1, 0, or -1
actual_sign = knockout_winner_sign  if fixture.knockout_winner is set
            = SIGN(actual_home - actual_away)  otherwise
```

### Points Engine Location
`app/services/points_engine.py` — function `grade_match_prediction(pred_home, pred_away, actual_home, actual_away, stage, knockout_winner_sign=None)`

---

## 2. Group Bracket Scoring

Users predict the final group standings by assigning each team to a position (1st through 4th) in each group. Each group has 4 teams, so there are 4 picks per group, 32 total for an 8-group tournament.

| Tier | Condition | Points |
|------|-----------|--------|
| **Exact Position** | `predicted_position == actual_final_position` | **5** per team |
| **Qualified (Wrong Order)** | `actual_position ≤ 2` AND `predicted_position ≤ 2` (team advances, but user got order wrong) | **2** per team |
| **Perfect Group Sweep Bonus** | All 4 teams in a group predicted in exactly correct order (positions 1–4) | **+10 bonus** lump sum |

**Maximum per group**: 5 × 4 (all exact) + 10 (sweep bonus) = **30 points**
**Maximum all groups** (8 groups): 8 × 30 = **240 points**

### Points Engine Location
`app/services/points_engine.py` — function `grade_group_bracket()`

---

## 3. Knockout Bracket Scoring

**Status: DESIGN APPROVED — NOT YET IMPLEMENTED**

The KO bracket uses the **"Any Path" validation model** with a scaling exponential reward curve. Points are calculated based on array intersection of teams — not rigid bracket slot matching. If a user predicted a country to reach a specific knockout milestone (e.g. Quarterfinals), and that country reaches that round in reality, the user receives full points regardless of how the team got there (different group standing, different bracket branch).

### Mathematical Logic
```
Points Earned = | T_predicted ∩ T_actual | × Round Point Value
```

The background service executes a set intersection between the predicted teams and actual teams for each round bucket.

### Master Points Allocation Matrix

Points scale dynamically with each subsequent round:

| Tournament Milestone | Scoring Condition / Logic Validation | Points Awarded |
| :--- | :--- | :--- |
| **Round of 32 Progress** | Team successfully qualifies for the R32 field (Top 2 or best 3rd). | **+3 points** per team |
| **Round of 16 Progress** | Team wins their R32 tie and advances to the final 16. | **+5 points** per team |
| **Quarterfinals Progress** | Team wins their R16 tie and advances to the final 8. | **+8 points** per team |
| **Semifinals Progress** | Team wins their QF tie and advances to the final 4. | **+12 points** per team |

### Finals Weekend & The Podium (Stage 6)

The final four positions require distinct, high-reward validation checks executed during the Stage 6 system gate.

**The Championship Tier (1st & 2nd):**
The engine evaluates the final match outcome against the user's upfront prediction using a two-tier hierarchy:
- **The Perfect Pick (+20 points):** The user correctly matches both the exact Champion and the exact Runner-Up in their correct final positions.
- **The Inverse Pick (+10 points):** The user correctly identifies both teams that reached the Final, but inverted the actual match winner (e.g., predicted France to win, but Argentina won).

**The Bronze Tier (3rd & 4th):**
Because the third-place consolation match is isolated into the Stage 6 timeline lock, the podium logic checks the consolation slots separately:
- **Correct 3rd Place Team (+8 points):** Successfully naming the winner of the third-place playoff match.
- **Correct 4th Place Team (+4 points):** Correctly matching the losing semifinalist who finishes in fourth place.

### Podium Summary

| Podium Tier | Condition | Points |
|-------------|-----------|--------|
| **Perfect Pick** | Correct Champion AND correct Runner-Up in correct positions | **+20** |
| **Inverse Pick** | Correctly identifies both finalists but inverts winner/runner-up | **+10** |
| **Correct 3rd Place** | Correctly names winner of 3rd-place playoff | **+8** |
| **Correct 4th Place** | Correctly matches losing semifinalist who finishes 4th | **+4** |

### Implementation Requirements

1. Implement background calculation task in `app/services/scoring.py` triggered whenever a tournament stage status updates to `'completed'`
2. Use Python set operations (`set(predicted) & set(actual)`) to evaluate "Any Path" progression for R32, R16, QF, and SF tiers
3. Construct a specific conditional block for Stage 6 to handle the podium hierarchy (+20 for Perfect, +10 for Inverse) and separate the +8 and +4 point bonuses for the 3rd/4th place playoff slots
4. Cascade all calculated points into a **`user_points_ledger`** table with a foreign key relation to `match_id` or `round_id` for transparent lineage tracking on the Leaderboard trajectory graph

### Points Engine Location
Implementation target: `app/services/scoring.py` (to be created). The existing `app/workers/bracket_engine.py` contains placeholder stubs (`resolve_completed_fixture()` and `resolve_group_standings()`) which must be implemented to call the scoring engine.

---

## 4. Points Aggregation

### User Total
Each user's `total_points` field on the `User` model is the sum of:
- All `MatchPrediction.points_awarded` values for that user
- `BracketPrediction.total_points` for that user's bracket

### Leaderboard
Redis sorted sets per league (`leaderboard:{league_id}`) store `(user_id, total_points)` pairs. Updated via `services/leaderboard.py`:
- `update_user_score()` — `ZADD` to sorted set
- `get_user_rank()` — `ZREVRANK` (0-indexed → +1 for display)
- `get_leaderboard()` — `ZREVRANGE` with scores

### Historical Snapshots
`historical_rankings` table stores point-in-time snapshots after each matchday/phase with `matchday_id` labels:
- `"GS-D1"`, `"GS-D2"`, `"GS-D3"` — Group Stage Days 1-3
- `"R16"` — Round of 16
- `"QF"` — Quarter Finals
- `"SF"` — Semi Finals
- `"F"` — Final

---

## 5. Summary Table

| Prediction Type | Exact | Partial | Bonus | Max Points |
|----------------|-------|---------|-------|-------------|
| Match Score | 5 pts (exact) | 3 pts (margin) / 2 pts (outcome) | None | 5 per match |
| Group Bracket (per team) | 5 pts | 2 pts (qualified) | +10 sweep | 30 per group |
| KO Bracket (per team) | 2–12 pts (escalating per round) | N/A — "Any Path" set intersection | +20 Perfect / +10 Inverse / +8 3rd / +4 4th | ~100+ (full bracket) |

---

## 6. Important Implementation Notes

- **Match grading IS automatic**: `resolve_completed_fixture()` in `bracket_engine.py` is a fully implemented 205-line module. The live poller (`poll_live_only()` → `_dispatch_grading()`) detects newly completed fixtures after each Wikipedia scrape and dispatches Celery tasks that grade predictions, update `User.total_points`, and sync Redis leaderboards.
- **Group bracket grading IS automatic**: `resolve_group_standings()` is implemented with idempotency guards (Redis key `grading:group:{group_code}:graded`). When all fixtures in a group transition to `completed`, the live poller dispatches group standings grading.
- **KO bracket scoring is NOT implemented**: The "Any Path" scoring engine (`app/services/scoring.py`) and `user_points_ledger` table do not exist yet. See [scoring.md Section 3](#3-knockout-bracket-scoring) and [open-tasks.md](open-tasks.md) Phase 1.
- **Daily cron gap**: The 06:00 UTC daily sync (`perform_sync()`) seeds fixtures but does NOT dispatch grading. Overnight completions won't be graded until the next live poll cycle. See project-review.md 1.22.
- **`points_awarded` column** on `match_predictions` is now written by `_resolve_completed_fixture()` during grading.
- **Bracket `total_points`** on `bracket_predictions` is now updated by `_resolve_group_standings()` when group standings are computed.
