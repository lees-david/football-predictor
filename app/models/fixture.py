import enum
from datetime import datetime
from sqlalchemy import String, Integer, BigInteger, Enum as PgEnum, DateTime, SmallInteger, func, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class FixtureStatus(str, enum.Enum):
    scheduled = "scheduled"
    live      = "live"
    completed = "completed"
    postponed = "postponed"

class FixtureStage(str, enum.Enum):
    group         = "group"
    round_32      = "round_32"
    round_16      = "round_16"
    quarter_final = "quarter_final"
    semi_final    = "semi_final"
    third_place   = "third_place"
    final         = "final"

class Fixture(Base):
    __tablename__ = "fixtures"

    id           : Mapped[int]           = mapped_column(Integer, primary_key=True)
    tournament_id: Mapped[int]           = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    # Synthetic stable identifier for the fixture (e.g. "wc2026-m1"), set by
    # core/initial_seed.py. Two roles:
    #   1. UNIQUE upsert key — the Wikipedia scraper re-runs idempotently by
    #      ON CONFLICT (external_id) DO UPDATE.
    #   2. Display match number — the frontend parses the trailing `m\d+` to
    #      render "#1, #2, ..." on Fixtures and MatchPredictions pages.
    # Originally intended for API-Football match IDs (which the project no
    # longer uses); name kept for backwards compatibility with the seed file.
    external_id  : Mapped[str | None]    = mapped_column(String(64), unique=True, nullable=True)
    stage        : Mapped[FixtureStage]  = mapped_column(PgEnum(FixtureStage, name="fixture_stage", create_type=False), nullable=False)
    group_code   : Mapped[str | None]    = mapped_column(String(2), nullable=True)    # "A"–"L", NULL for KO
    matchday     : Mapped[int | None]    = mapped_column(SmallInteger, nullable=True) # 1-3 for group stage
    home_team    : Mapped[str]           = mapped_column(String(80), nullable=False)
    home_logo    : Mapped[str | None]    = mapped_column(String(255), nullable=True)
    away_team    : Mapped[str]           = mapped_column(String(80), nullable=False)
    away_logo    : Mapped[str | None]    = mapped_column(String(255), nullable=True)
    kickoff_time : Mapped[datetime]      = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    home_score   : Mapped[int | None]    = mapped_column(SmallInteger, nullable=True)
    away_score   : Mapped[int | None]    = mapped_column(SmallInteger, nullable=True)
    status       : Mapped[FixtureStatus] = mapped_column(
                                               PgEnum(FixtureStatus, name="fixture_status", create_type=False),
                                               nullable=False, default=FixtureStatus.scheduled, index=True
                                           )
    bracket_slot : Mapped[str | None]    = mapped_column(String(20), nullable=True)  # "W49", "R16-A" etc.
    # Scores after extra time — NULL if the match was settled in 90 mins.
    home_score_aet  : Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    away_score_aet  : Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # For KO fixtures that reach AET/penalties: the team that actually progressed.
    # NULL for group-stage matches and KO matches settled in 90 mins.
    knockout_winner      : Mapped[str | None] = mapped_column(String(80), nullable=True)
    # football-data.org v4 integration columns
    data_source_match_id : Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True)
    match_duration       : Mapped[str | None] = mapped_column(String(20), nullable=True)  # REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT
    home_pens            : Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    away_pens            : Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    venue        : Mapped[str | None]    = mapped_column(String(150), nullable=True)
    updated_at   : Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    tournament        : Mapped["Tournament"]            = relationship(back_populates="fixtures")
    match_predictions : Mapped[list["MatchPrediction"]] = relationship(back_populates="fixture")
