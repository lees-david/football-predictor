from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class Team(Base):
    __tablename__ = "teams"

    id                  : Mapped[int]      = mapped_column(Integer, primary_key=True)
    tournament_id       : Mapped[int]      = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    data_source_team_id : Mapped[int]      = mapped_column(Integer, unique=True, nullable=False)
    name                : Mapped[str]      = mapped_column(String(80), nullable=False)
    tla                 : Mapped[str|None] = mapped_column(String(5), nullable=True)
    crest_url           : Mapped[str|None] = mapped_column(String(512), nullable=True)
