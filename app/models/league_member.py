from datetime import datetime
from sqlalchemy import Integer, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class LeagueMember(Base):
    __tablename__ = "league_members"
    __table_args__ = (
        UniqueConstraint("user_id", "league_id", name="uq_league_member"),
    )

    id        : Mapped[int]      = mapped_column(Integer, primary_key=True)
    user_id   : Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    league_id : Mapped[int]      = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at : Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user   : Mapped["User"]   = relationship(back_populates="league_memberships")
    league : Mapped["League"] = relationship(back_populates="members")
