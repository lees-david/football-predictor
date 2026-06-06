from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from models.fixture import FixtureStatus, FixtureStage

class FixtureCreate(BaseModel):
    external_id: Optional[str]
    stage: FixtureStage
    group_code: Optional[str]
    matchday: Optional[int]
    home_team: str
    home_logo: Optional[str] = None
    away_team: str
    away_logo: Optional[str] = None
    kickoff_time: datetime
    bracket_slot: Optional[str]
    venue: Optional[str] = None

class FixtureResponse(BaseModel):
    id: int
    external_id: Optional[str]
    stage: FixtureStage
    group_code: Optional[str]
    matchday: Optional[int]
    home_team: str
    home_logo: Optional[str] = None
    away_team: str
    away_logo: Optional[str] = None
    kickoff_time: datetime
    home_score: Optional[int]
    away_score: Optional[int]
    home_score_aet: Optional[int] = None
    away_score_aet: Optional[int] = None
    knockout_winner: Optional[str] = None
    status: FixtureStatus
    bracket_slot: Optional[str]
    venue: Optional[str] = None
    updated_at: datetime

    class Config:
        from_attributes = True
