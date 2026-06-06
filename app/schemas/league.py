from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class LeagueCreate(BaseModel):
    name: str
    tournament_id: Optional[int] = None

class LeagueJoin(BaseModel):
    invite_token: str

class LeagueResponse(BaseModel):
    id: int
    name: str
    invite_token: str
    created_by: int
    is_active: bool
    logo_url: Optional[str] = None
    created_at: datetime
    member_count: Optional[int] = None
    my_rank: Optional[int] = None

    class Config:
        from_attributes = True
