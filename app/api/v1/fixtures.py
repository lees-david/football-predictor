from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from api.deps import get_db, get_current_user
from models.fixture import Fixture
from models.user import User
from schemas.fixture import FixtureResponse

router = APIRouter()

# A single tournament currently produces 104 fixtures (72 group + 32 KO).
# Default limit of 500 leaves headroom for one tournament; cap at 500 so a
# misbehaving client cannot mass-fetch the entire history in one request.
_DEFAULT_LIMIT = 500
_MAX_LIMIT = 500


@router.get("", response_model=list[FixtureResponse])
async def list_fixtures(
    tournament_id: int | None = None,
    limit: int = Query(_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = select(Fixture)
    if tournament_id is not None:
        stmt = stmt.where(Fixture.tournament_id == tournament_id)
    stmt = stmt.order_by(Fixture.kickoff_time, Fixture.group_code).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()

@router.get("/{fixture_id}", response_model=FixtureResponse)
async def get_fixture(fixture_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    stmt = select(Fixture).where(Fixture.id == fixture_id)
    result = await db.execute(stmt)
    fixture = result.scalar_one_or_none()
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
    return fixture
