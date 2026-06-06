import secrets
from datetime import datetime
from sqlalchemy import String, Text, Integer, ForeignKey, DateTime, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class League(Base):
    __tablename__ = "leagues"

    id           : Mapped[int]      = mapped_column(Integer, primary_key=True)
    name         : Mapped[str]      = mapped_column(String(120), nullable=False)
    invite_token : Mapped[str]      = mapped_column(
                                          String(16), unique=True, nullable=False,
                                          default=lambda: secrets.token_urlsafe(12)
                                      )
    created_by   : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    tournament_id: Mapped[int]      = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    is_active      : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=True)
    emails_enabled : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)
    logo_url       : Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    creator          : Mapped["User"]                    = relationship(foreign_keys=[created_by])
    tournament       : Mapped["Tournament"]              = relationship(back_populates="leagues")
    members          : Mapped[list["LeagueMember"]]      = relationship(back_populates="league", cascade="all, delete-orphan")
    historical_ranks : Mapped[list["HistoricalRanking"]] = relationship(back_populates="league", cascade="all, delete-orphan")
