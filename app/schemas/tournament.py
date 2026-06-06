from pydantic import BaseModel
from datetime import datetime

class TournamentBase(BaseModel):
    name: str
    is_active: bool = True
    has_bracket: bool = False

class TournamentCreate(TournamentBase):
    pass

class TournamentResponse(TournamentBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True
