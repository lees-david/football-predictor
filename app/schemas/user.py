from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional
from models.user import UserRole

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    team_name: str
    invite_token: str
    email_opt_in: Optional[bool] = False

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    team_name: str
    role: UserRole
    total_points: int
    current_rank: int | None
    is_active: bool
    can_manage_leagues: bool
    can_invite_users: bool
    created_at: datetime

    class Config:
        from_attributes = True

class BulkProvisionRequest(BaseModel):
    # Processed via Form Data / File Upload, but represented here for completeness
    pass

class UserPermissionsUpdate(BaseModel):
    can_manage_leagues: bool
    can_invite_users: bool


class PointsHistoryEntry(BaseModel):
    id: int
    tournament_id: int
    tournament_name: str
    points_awarded: int
    source_type: str
    source_id: str
    source_label: str
    match_number: str | None = None   # e.g. "M42"
    context: str | None = None        # e.g. "Group A · MD2" or "Round of 16"
    reason: str | None = None         # e.g. "Exact score", "Correct margin"
    created_at: datetime


class PointsHistoryTournamentSummary(BaseModel):
    tournament_id: int
    tournament_name: str
    total_points: int
    match_points: int
    group_bracket_points: int
    ko_bracket_points: int


class PointsHistoryResponse(BaseModel):
    summaries: list[PointsHistoryTournamentSummary]
    entries: list[PointsHistoryEntry]
