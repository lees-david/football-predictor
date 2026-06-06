from sqlalchemy import Integer, ForeignKey, String, SmallInteger, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class BracketGroupPick(Base):
    """One row per (user, group, position). e.g. user X picks Brazil 1st in Group G."""
    __tablename__ = "bracket_group_picks"
    __table_args__ = (
        UniqueConstraint("bracket_id", "group_code", "position", name="uq_bracket_group_pos"),
    )

    id           : Mapped[int] = mapped_column(Integer, primary_key=True)
    bracket_id   : Mapped[int] = mapped_column(ForeignKey("bracket_predictions.id", ondelete="CASCADE"), nullable=False, index=True)
    group_code   : Mapped[str] = mapped_column(String(1), nullable=False)   # "A"–"L" (12 groups in the 2026 48-team format)
    position     : Mapped[int] = mapped_column(SmallInteger, nullable=False) # 1–4
    predicted_team: Mapped[str]= mapped_column(String(80), nullable=False)

    bracket : Mapped["BracketPrediction"] = relationship(back_populates="group_picks")
