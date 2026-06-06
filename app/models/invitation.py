from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base

class Invitation(Base):
    __tablename__ = "invitations"

    id         : Mapped[int]           = mapped_column(Integer, primary_key=True)
    token      : Mapped[str]           = mapped_column(String(64), unique=True, nullable=False, index=True)
    league_id  : Mapped[int]           = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by : Mapped[int]           = mapped_column(ForeignKey("users.id"), nullable=False)
    claimed_by : Mapped[int | None]    = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at : Mapped[datetime]      = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    claimed_at : Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at : Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_revoked : Mapped[bool]          = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    league     : Mapped["League"]      = relationship()
    creator    : Mapped["User"]        = relationship(foreign_keys=[created_by])
    claimer    : Mapped["User | None"] = relationship(foreign_keys=[claimed_by])
