from datetime import datetime
from sqlalchemy import Integer, ForeignKey, Boolean, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class BracketPrediction(Base):
    """One-per-user-per-tournament container; is_locked toggled globally at tournament open."""
    __tablename__ = "bracket_predictions"
    __table_args__ = (UniqueConstraint("user_id", "tournament_id", name="uq_bracket_per_user_tournament"),)

    id           : Mapped[int]      = mapped_column(Integer, primary_key=True)
    user_id      : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    tournament_id: Mapped[int]      = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    is_locked    : Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    total_points : Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    submitted_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user        : Mapped["User"]                   = relationship(back_populates="bracket_predictions")
    tournament  : Mapped["Tournament"]             = relationship(back_populates="bracket_predictions")
    group_picks : Mapped[list["BracketGroupPick"]] = relationship(back_populates="bracket", cascade="all, delete-orphan")
    ko_picks    : Mapped[list["BracketKoPick"]]    = relationship(back_populates="bracket", cascade="all, delete-orphan")
