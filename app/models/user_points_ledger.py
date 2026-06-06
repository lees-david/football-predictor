import enum
from datetime import datetime
from sqlalchemy import Integer, ForeignKey, String, Enum as PgEnum, DateTime, SmallInteger, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class PointsSourceType(str, enum.Enum):
    match = "match"
    group_bracket = "group_bracket"
    ko_bracket = "ko_bracket"


class UserPointsLedger(Base):
    __tablename__ = "user_points_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id"), nullable=False, index=True)
    points_awarded: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    source_type: Mapped[PointsSourceType] = mapped_column(
        PgEnum(PointsSourceType, name="points_source_type", create_type=False),
        nullable=False,
    )
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()
    tournament: Mapped["Tournament"] = relationship()
