from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class ScoreBreakdown(BaseModel):
    exact_score: int = 0      # 5-pt hits
    correct_margin: int = 0   # 3-pt hits
    correct_outcome: int = 0  # 2-pt hits
    bracket_pts: int = 0      # group bracket + KO bracket points

class LeaderboardEntry(BaseModel):
    rank: int
    user_id: int
    display_name: str
    team_name: Optional[str] = None
    total_points: int
    delta: Optional[int] = None
    breakdown: Optional[ScoreBreakdown] = None

class LeaderboardResponse(BaseModel):
    league_id: int
    entries: list[LeaderboardEntry]

class GlobalRankResponse(BaseModel):
    rank: Optional[int] = None
    total_players: int

class HistoricalRankResponse(BaseModel):
    user_id: int
    display_name: str
    matchday_id: Optional[str]
    rank_at_time: int
    points_at_time: int
    recorded_at: datetime

    class Config:
        from_attributes = True
