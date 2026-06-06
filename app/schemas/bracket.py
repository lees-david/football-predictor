from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from models.bracket_ko_pick import KoRound


class KoStageDetail(BaseModel):
    stage: str                    # "round_32", "round_16", "quarter_final", "semi_final", "finals"
    label: str                    # human-readable
    completed: bool
    predicted_teams: list[str]    # user's picks for this round (sorted)
    actual_teams: list[str]       # teams that actually appeared (sorted)
    matched_teams: list[str]      # intersection (sorted)
    points: int                   # points from ledger for this stage
    pts_per_team: int | None      # base rate per matched team (None for finals)
    total_slots: int              # number of picks the user makes at this round


class BracketPointsBreakdown(BaseModel):
    groups: dict[str, int] = {}
    ko_stages: dict[str, int] = {}
    ko_stage_details: list[KoStageDetail] = []

class BracketGroupPickCreate(BaseModel):
    group_code: str = Field(..., max_length=1)
    position: int = Field(..., ge=1, le=4)
    predicted_team: str

class BracketKoPickCreate(BaseModel):
    round: KoRound
    slot: str
    predicted_team: str

class BracketPredictionCreate(BaseModel):
    group_picks: List[BracketGroupPickCreate]
    ko_picks: List[BracketKoPickCreate]

class BracketGroupPickResponse(BaseModel):
    id: int
    group_code: str
    position: int
    predicted_team: str
    
    class Config:
        from_attributes = True

class BracketKoPickResponse(BaseModel):
    id: int
    round: KoRound
    slot: str
    predicted_team: str

    class Config:
        from_attributes = True

class BracketPredictionResponse(BaseModel):
    id: int
    user_id: int
    tournament_id: int
    is_locked: bool
    total_points: int
    submitted_at: datetime
    updated_at: datetime
    group_picks: List[BracketGroupPickResponse]
    ko_picks: List[BracketKoPickResponse]
    points_breakdown: BracketPointsBreakdown = Field(default_factory=BracketPointsBreakdown)

    class Config:
        from_attributes = True
