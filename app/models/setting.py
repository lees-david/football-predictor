from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base

class Setting(Base):
    __tablename__ = "settings"

    key   : Mapped[str] = mapped_column(String(100), primary_key=True)
    value : Mapped[str] = mapped_column(String(255), nullable=False)
