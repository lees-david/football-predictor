from sqlalchemy import Integer, Boolean, Enum as PgEnum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base
from models.email_template import EmailType


class UserEmailPreference(Base):
    __tablename__ = "user_email_preferences"
    __table_args__ = (UniqueConstraint("user_id", "email_type"),)

    id         : Mapped[int]       = mapped_column(Integer, primary_key=True)
    user_id    : Mapped[int]       = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email_type : Mapped[EmailType] = mapped_column(PgEnum(EmailType, name="email_type", create_type=False), nullable=False)
    opted_in   : Mapped[bool]      = mapped_column(Boolean, nullable=False, default=False)
