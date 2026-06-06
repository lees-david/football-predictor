import enum
from datetime import datetime
from sqlalchemy import Integer, String, Text, Enum as PgEnum, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class EmailType(str, enum.Enum):
    welcome        = "welcome"
    round_summary  = "round_summary"
    daily_digest   = "daily_digest"
    password_reset = "password_reset"
    broadcast      = "broadcast"


class EmailTemplate(Base):
    __tablename__ = "email_template"

    id         : Mapped[int]       = mapped_column(Integer, primary_key=True)
    email_type : Mapped[EmailType] = mapped_column(PgEnum(EmailType, name="email_type", create_type=False), nullable=False, unique=True)
    subject    : Mapped[str]       = mapped_column(String(255), nullable=False)
    body_html  : Mapped[str]       = mapped_column(Text, nullable=False)
    updated_at : Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
