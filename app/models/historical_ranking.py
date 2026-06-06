from datetime import datetime
from sqlalchemy import Integer, SmallInteger, ForeignKey, DateTime, String, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class HistoricalRanking(Base):
    __tablename__ = "historical_rankings"
    __table_args__ = (
        Index("ix_histrank_user_league_recorded", "user_id", "league_id", "recorded_at"),
    )

    id             : Mapped[int]        = mapped_column(Integer, primary_key=True)
    user_id        : Mapped[int]        = mapped_column(ForeignKey("users.id"), nullable=False)
    league_id      : Mapped[int]        = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False)
    matchday_id    : Mapped[str | None] = mapped_column(String(30), nullable=True)  # "GS-D1", "GS-D2", "GS-D3", "R16", "QF", "SF", "F"
    points_at_time : Mapped[int]        = mapped_column(Integer, nullable=False)
    rank_at_time   : Mapped[int]        = mapped_column(SmallInteger, nullable=False)
    recorded_at    : Mapped[datetime]   = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)

    user   : Mapped["User"]   = relationship(back_populates="historical_ranks")
    league : Mapped["League"] = relationship(back_populates="historical_ranks")
