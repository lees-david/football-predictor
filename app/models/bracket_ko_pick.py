import enum
from sqlalchemy import Integer, ForeignKey, String, Enum as PgEnum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class KoRound(str, enum.Enum):
    round_32    = "round_32"      # 16 slots
    round_16    = "round_16"      # 8 slots
    quarter_final = "quarter_final" # 4 slots
    semi_final    = "semi_final"    # 2 slots
    third_place = "third_place"   # 1 slot — 3rd place playoff
    final       = "final"         # 1 slot
    champion    = "champion"      # 1 slot — tournament winner

class BracketKoPick(Base):
    """One row per (user, KO round, slot). Slot is a stable bracket position string."""
    __tablename__ = "bracket_ko_picks"
    __table_args__ = (
        UniqueConstraint("bracket_id", "round", "slot", name="uq_bracket_ko_slot"),
    )

    id             : Mapped[int]     = mapped_column(Integer, primary_key=True)
    bracket_id     : Mapped[int]     = mapped_column(ForeignKey("bracket_predictions.id", ondelete="CASCADE"), nullable=False, index=True)
    round          : Mapped[KoRound] = mapped_column(PgEnum(KoRound, name="ko_round", create_type=False), nullable=False)
    slot           : Mapped[str]     = mapped_column(String(10), nullable=False)   # e.g. "R16-1", "QF-2"
    predicted_team : Mapped[str]     = mapped_column(String(80), nullable=False)

    bracket : Mapped["BracketPrediction"] = relationship(back_populates="ko_picks")
