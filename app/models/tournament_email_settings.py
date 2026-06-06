from sqlalchemy import Integer, Boolean, Enum as PgEnum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base
from models.email_template import EmailType


class TournamentEmailSettings(Base):
    __tablename__ = "tournament_email_settings"
    __table_args__ = (UniqueConstraint("tournament_id", "email_type"),)

    id            : Mapped[int]       = mapped_column(Integer, primary_key=True)
    tournament_id : Mapped[int]       = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), nullable=False)
    email_type    : Mapped[EmailType] = mapped_column(PgEnum(EmailType, name="email_type", create_type=False), nullable=False)
    enabled       : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)

    tournament    : Mapped["Tournament"] = relationship(foreign_keys=[tournament_id])
