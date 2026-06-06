import enum
from datetime import datetime
from sqlalchemy import String, Integer, Enum as PgEnum, DateTime, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class UserRole(str, enum.Enum):
    admin  = "admin"
    player = "player"

class User(Base):
    __tablename__ = "users"

    id              : Mapped[int]           = mapped_column(Integer, primary_key=True)
    email           : Mapped[str]           = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password : Mapped[str]           = mapped_column(String(255), nullable=False)
    display_name    : Mapped[str]           = mapped_column(String(100), nullable=False)
    team_name       : Mapped[str]           = mapped_column(String(100), nullable=False, server_default='')
    role            : Mapped[UserRole]      = mapped_column(PgEnum(UserRole, name="user_role", create_type=False), nullable=False, default=UserRole.player)
    total_points    : Mapped[int]           = mapped_column(Integer, nullable=False, default=0)
    current_rank    : Mapped[int | None]    = mapped_column(Integer, nullable=True)
    is_active       : Mapped[bool]          = mapped_column(Boolean, nullable=False, default=True)
    can_manage_leagues    : Mapped[bool]       = mapped_column(Boolean, nullable=False, default=False)
    can_manage_tournaments: Mapped[bool]       = mapped_column(Boolean, nullable=False, default=False)
    can_invite_users      : Mapped[bool]       = mapped_column(Boolean, nullable=False, default=True)
    created_at      : Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at      : Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    league_memberships  : Mapped[list["LeagueMember"]]      = relationship(back_populates="user")
    match_predictions   : Mapped[list["MatchPrediction"]]   = relationship(back_populates="user")
    bracket_predictions : Mapped[list["BracketPrediction"]] = relationship(back_populates="user")
    historical_ranks    : Mapped[list["HistoricalRanking"]] = relationship(back_populates="user")
