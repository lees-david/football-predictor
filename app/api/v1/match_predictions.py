from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

from api.deps import get_db, get_current_user
from models.match_prediction import MatchPrediction
from models.fixture import Fixture, FixtureStage
from models.user import User
from schemas.match_prediction import MatchPredictionCreate, MatchPredictionResponse

def is_placeholder_name(name: str) -> bool:
    low = name.lower()
    return any(x in low for x in ["match", "placeholder", "winner", "loser", "runner", "group", "tbd"])

router = APIRouter()

@router.post("", response_model=MatchPredictionResponse)
async def submit_prediction(pred_in: MatchPredictionCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Fetch fixture
    stmt = select(Fixture).where(Fixture.id == pred_in.fixture_id)
    fixture = (await db.execute(stmt)).scalar_one_or_none()
    
    if not fixture:
        raise HTTPException(status_code=404, detail="Fixture not found")
        
    # Check if knockout stage is open (has all participants confirmed)
    if fixture.stage != FixtureStage.group:
        stmt_stage_fixtures = select(Fixture).where(
            Fixture.tournament_id == fixture.tournament_id,
            Fixture.stage == fixture.stage
        )
        stage_fixtures = (await db.execute(stmt_stage_fixtures)).scalars().all()
        has_placeholders = any(
            is_placeholder_name(f.home_team) or is_placeholder_name(f.away_team)
            for f in stage_fixtures
        )
        if has_placeholders:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Predictions for this stage ({fixture.stage.value}) are closed. Waiting for all participants to be confirmed."
            )
            
    # Check 6-Stage blanket locks (Layer 0)
    if fixture.stage in (FixtureStage.third_place, FixtureStage.final):
        stages_to_check = [FixtureStage.third_place, FixtureStage.final]
    else:
        stages_to_check = [fixture.stage]

    # Query the first kickoff time of this stage (or stages) in the tournament
    stmt_min = select(Fixture.kickoff_time).where(
        Fixture.tournament_id == fixture.tournament_id,
        Fixture.stage.in_(stages_to_check)
    ).order_by(Fixture.kickoff_time.asc()).limit(1)
    
    first_kickoff = (await db.execute(stmt_min)).scalar_one_or_none()
    
    if first_kickoff:
        if datetime.now(timezone.utc) >= first_kickoff:
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=f"Submission window has closed. The entire phase ({fixture.stage.value}) is locked."
            )

    # Check individual lock safety buffer (Layer 1)
    now_utc = datetime.now(timezone.utc)
    within_lock_window = now_utc >= fixture.kickoff_time - timedelta(minutes=15)
    if within_lock_window:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Submission window has closed for this fixture.")

    # Check if existing prediction
    stmt_pred = select(MatchPrediction).where(
        MatchPrediction.user_id == current_user.id,
        MatchPrediction.fixture_id == pred_in.fixture_id
    )
    existing = (await db.execute(stmt_pred)).scalar_one_or_none()

    if existing:
        # Reject update if the record is already server-locked
        if existing.is_locked:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="This prediction is locked and cannot be changed.")
        existing.predicted_home = pred_in.predicted_home
        existing.predicted_away = pred_in.predicted_away
        pred = existing
    else:
        pred = MatchPrediction(
            user_id=current_user.id,
            fixture_id=pred_in.fixture_id,
            predicted_home=pred_in.predicted_home,
            predicted_away=pred_in.predicted_away,
        )
        db.add(pred)
        
    await db.commit()
    await db.refresh(pred)
    return pred

@router.get("/me", response_model=list[MatchPredictionResponse])
async def my_predictions(
    tournament_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stmt = select(MatchPrediction).where(MatchPrediction.user_id == current_user.id)
    if tournament_id is not None:
        stmt = stmt.join(Fixture, MatchPrediction.fixture_id == Fixture.id).where(Fixture.tournament_id == tournament_id)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.delete("/clear")
async def clear_match_predictions(
    tournament_id: int,
    stage: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Clears match predictions that are not yet locked for the current user in a tournament.
    Optional 'stage' parameter allows clearing only a specific round.
    """
    import sqlalchemy as sa
    now_utc = datetime.now(timezone.utc)
    
    # Query all stages for this tournament and find their first kickoff times
    stmt_stages = select(Fixture.stage, sa.func.min(Fixture.kickoff_time)).where(
        Fixture.tournament_id == tournament_id
    ).group_by(Fixture.stage)
    
    stage_kickoffs = (await db.execute(stmt_stages)).all()
    locked_stages = set()
    for stg, min_ko in stage_kickoffs:
        if min_ko:
            if now_utc >= min_ko:
                locked_stages.add(stg)
                if stg in (FixtureStage.third_place, FixtureStage.final):
                    locked_stages.add(FixtureStage.third_place)
                    locked_stages.add(FixtureStage.final)

    # Fetch user's predictions for this tournament
    stmt_select = select(MatchPrediction).join(Fixture, MatchPrediction.fixture_id == Fixture.id).where(
        MatchPrediction.user_id == current_user.id,
        Fixture.tournament_id == tournament_id
    )
    if stage:
        stmt_select = stmt_select.where(Fixture.stage == stage)
        
    preds = (await db.execute(stmt_select)).scalars().all()
    
    cleared_count = 0
    for pred in preds:
        fixture = await db.get(Fixture, pred.fixture_id)
        if not fixture:
            continue
        is_individually_locked = now_utc >= fixture.kickoff_time - timedelta(minutes=15)
        is_stage_locked = fixture.stage in locked_stages
        
        if not is_individually_locked and not is_stage_locked:
            await db.delete(pred)
            cleared_count += 1
            
    await db.commit()
    return {"message": f"Successfully cleared {cleared_count} predictions."}
