import enum
from datetime import datetime
from sqlalchemy import String, Integer, Text, Boolean, Enum as PgEnum, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from core.database import Base
from models.email_template import EmailType


class EmailStatus(str, enum.Enum):
    queued  = "queued"
    sent    = "sent"
    failed  = "failed"
    bounced = "bounced"


class EmailLog(Base):
    __tablename__ = "email_log"

    id            : Mapped[int]            = mapped_column(Integer, primary_key=True)
    user_id       : Mapped[int]            = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    tournament_id : Mapped[int | None]     = mapped_column(ForeignKey("tournaments.id", ondelete="SET NULL"), nullable=True)
    email_type    : Mapped[EmailType]      = mapped_column(PgEnum(EmailType, name="email_type", create_type=False), nullable=False)
    subject       : Mapped[str]            = mapped_column(String(255), nullable=False)
    to_address    : Mapped[str]            = mapped_column(String(320), nullable=False)
    body_html     : Mapped[str]            = mapped_column(Text, nullable=False)
    simulated     : Mapped[bool]           = mapped_column(Boolean, nullable=False, default=True)
    status        : Mapped[str]            = mapped_column(String(20), nullable=False, default="queued")
    resend_message_id : Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    sent_at       : Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at    : Mapped[datetime]       = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user          : Mapped["User"]         = relationship(foreign_keys=[user_id])
