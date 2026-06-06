from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class MatchPredictionCreate(BaseModel):
    fixture_id: int
    predicted_home: int = Field(..., ge=0, le=20)
    predicted_away: int = Field(..., ge=0, le=20)

class MatchPredictionResponse(BaseModel):
    id: int
    user_id: int
    fixture_id: int
    predicted_home: int
    predicted_away: int
    points_awarded: int
    is_locked: bool
    submitted_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
