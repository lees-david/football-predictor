from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.deps import get_db, get_current_user, get_current_admin
from models.tournament import Tournament
from models.user import User
from schemas.tournament import TournamentResponse, TournamentCreate

router = APIRouter()

@router.get("", response_model=list[TournamentResponse])
async def list_tournaments(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = select(Tournament).where(Tournament.is_active == True).order_by(Tournament.created_at)
    result = await db.execute(stmt)
    return result.scalars().all()

@router.get("/{tournament_id}", response_model=TournamentResponse)
async def get_tournament(tournament_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = select(Tournament).where(Tournament.id == tournament_id)
    result = await db.execute(stmt)
    tournament = result.scalar_one_or_none()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    return tournament

@router.post("", response_model=TournamentResponse, dependencies=[Depends(get_current_admin)])
async def create_tournament(tournament_in: TournamentCreate, db: AsyncSession = Depends(get_db)):
    tournament = Tournament(
        name=tournament_in.name,
        is_active=tournament_in.is_active,
        has_bracket=tournament_in.has_bracket
    )
    db.add(tournament)
    await db.commit()
    await db.refresh(tournament)
    return tournament
