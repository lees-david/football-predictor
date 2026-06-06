from datetime import datetime
from sqlalchemy import (
    Integer, SmallInteger, Boolean, ForeignKey,
    DateTime, UniqueConstraint, CheckConstraint, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class MatchPrediction(Base):
    __tablename__ = "match_predictions"
    __table_args__ = (
        UniqueConstraint("user_id", "fixture_id", name="uq_match_pred_user_fixture"),
        CheckConstraint("predicted_home >= 0", name="ck_match_pred_home_nn"),
        CheckConstraint("predicted_away >= 0", name="ck_match_pred_away_nn"),
    )

    id             : Mapped[int]      = mapped_column(Integer, primary_key=True)
    user_id        : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    fixture_id     : Mapped[int]      = mapped_column(ForeignKey("fixtures.id"), nullable=False, index=True)
    predicted_home : Mapped[int]      = mapped_column(SmallInteger, nullable=False)
    predicted_away : Mapped[int]      = mapped_column(SmallInteger, nullable=False)
    points_awarded : Mapped[int]      = mapped_column(SmallInteger, nullable=False, default=0)
    is_locked      : Mapped[bool]     = mapped_column(Boolean, nullable=False, default=False)
    submitted_at   : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at     : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user    : Mapped["User"]    = relationship(back_populates="match_predictions")
    fixture : Mapped["Fixture"] = relationship(back_populates="match_predictions")
