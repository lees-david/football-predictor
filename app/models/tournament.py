import enum
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, func, Boolean, Enum as PgEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base


class EmailMode(str, enum.Enum):
    simulation = "simulation"
    live       = "live"


class Tournament(Base):
    __tablename__ = "tournaments"

    id            : Mapped[int]       = mapped_column(Integer, primary_key=True)
    name          : Mapped[str]       = mapped_column(String(120), nullable=False)
    is_active     : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=True)
    has_bracket   : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)
    api_league_id : Mapped[int | None] = mapped_column(Integer, nullable=True)
    api_season    : Mapped[int | None] = mapped_column(Integer, nullable=True)
    email_mode    : Mapped[EmailMode] = mapped_column(
                        PgEnum(EmailMode, name="email_mode", create_type=False),
                        nullable=False, default=EmailMode.simulation
                    )
    created_at            : Mapped[datetime]         = mapped_column(DateTime(timezone=True), server_default=func.now())
    predictions_reset_at  : Mapped[datetime | None]  = mapped_column(DateTime(timezone=True), nullable=True)

    fixtures            : Mapped[list["Fixture"]]           = relationship(back_populates="tournament")
    leagues             : Mapped[list["League"]]            = relationship(back_populates="tournament")
    bracket_predictions : Mapped[list["BracketPrediction"]] = relationship(back_populates="tournament")
