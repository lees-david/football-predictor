from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from pydantic import BaseModel

from api.deps import get_db, get_current_user, get_current_admin, get_current_league_manager, get_current_user_optional
from models.league import League
from models.league_member import LeagueMember
from models.user import User, UserRole
from models.invitation import Invitation
from schemas.league import LeagueResponse, LeagueCreate, LeagueJoin

router = APIRouter()

@router.post("", response_model=LeagueResponse, dependencies=[Depends(get_current_league_manager)])
async def create_league(league_in: LeagueCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    from services.tournaments import resolve_tournament_id
    t_id = await resolve_tournament_id(db, league_in.tournament_id)
    league = League(name=league_in.name, created_by=current_user.id, tournament_id=t_id)
    db.add(league)
    await db.flush() # Flush to populate league.id
    
    # Auto-join the creator as a league member
    member = LeagueMember(league_id=league.id, user_id=current_user.id)
    db.add(member)
    
    await db.commit()
    await db.refresh(league)
    return league

@router.delete("/{league_id}", response_model=dict)
async def delete_league(
    league_id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_league_manager)
):
    stmt = select(League).where(League.id == league_id)
    result = await db.execute(stmt)
    league = result.scalar_one_or_none()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    
    if current_user.role != UserRole.admin and league.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="You can only remove leagues you have created.")

    await db.delete(league)
    await db.commit()
    return {"message": "League successfully removed"}

@router.get("", response_model=list[LeagueResponse])
async def list_leagues(
    tournament_id: int | None = None, 
    joined_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.league_member import LeagueMember
    from sqlalchemy import func
    from services.leaderboard import get_user_rank

    stmt = select(League)
    if tournament_id is not None:
        stmt = stmt.where(League.tournament_id == tournament_id)
        
    if joined_only:
        stmt = stmt.join(LeagueMember, LeagueMember.league_id == League.id).where(LeagueMember.user_id == current_user.id)
    elif current_user.role != UserRole.admin:
        # Non-admins can only see leagues they created or joined
        stmt = stmt.join(
            LeagueMember, 
            (LeagueMember.league_id == League.id) & (LeagueMember.user_id == current_user.id),
            isouter=True
        ).where(
            (League.created_by == current_user.id) | (LeagueMember.id.isnot(None))
        )
    result = await db.execute(stmt)
    leagues_list = result.scalars().all()
    
    response = []
    for league in leagues_list:
        # Count members
        cnt_res = await db.execute(select(func.count(LeagueMember.id)).where(LeagueMember.league_id == league.id))
        member_count = cnt_res.scalar() or 0
        
        # Get user rank
        my_rank = await get_user_rank(league.id, current_user.id)
        
        # Build response item
        league_res = LeagueResponse.model_validate(league)
        league_res.member_count = member_count
        league_res.my_rank = my_rank
        response.append(league_res)
        
    return response

@router.get("/invite-details/{token}", response_model=dict)
async def get_invite_details(
    token: str,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional)
):
    # First search in invitations table (new system)
    invitation_stmt = select(Invitation, League).join(League, Invitation.league_id == League.id).where(
        Invitation.token == token,
        Invitation.is_revoked == False,
        Invitation.claimed_by.is_(None)
    )
    invitation_result = await db.execute(invitation_stmt)
    row = invitation_result.first()
    
    league = None
    if not row:
        legacy_stmt = select(League).where(League.invite_token == token)
        legacy_res = await db.execute(legacy_stmt)
        league = legacy_res.scalar_one_or_none()
        if not league:
            raise HTTPException(status_code=404, detail="Invalid invite token")
    else:
        invitation, league = row
        if invitation.expires_at and datetime.now(timezone.utc) > invitation.expires_at:
            raise HTTPException(status_code=400, detail="Invite token has expired")
        
    is_member = False
    if current_user and league:
        member_check = select(LeagueMember).where(
            LeagueMember.user_id == current_user.id,
            LeagueMember.league_id == league.id
        )
        is_member_res = await db.execute(member_check)
        if is_member_res.scalar_one_or_none() is not None:
            is_member = True
            
    return {"league_name": league.name, "token": token, "is_member": is_member}

@router.post("/join", response_model=dict)
async def join_league(join_in: LeagueJoin, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    # First search in invitations table (new system)
    invitation_stmt = select(Invitation).where(
        Invitation.token == join_in.invite_token,
        Invitation.is_revoked == False,
        Invitation.claimed_by.is_(None)
    )
    invitation_result = await db.execute(invitation_stmt)
    invitation = invitation_result.scalar_one_or_none()
    
    # Check if we should check expiration
    if invitation and invitation.expires_at and datetime.now(timezone.utc) > invitation.expires_at:
        invitation = None # expired
        
    league = None
    if invitation:
        result = await db.execute(select(League).where(League.id == invitation.league_id))
        league = result.scalar_one_or_none()
    else:
        # Fallback to legacy
        stmt = select(League).where(League.invite_token == join_in.invite_token)
        result = await db.execute(stmt)
        league = result.scalar_one_or_none()
        
    if not league:
        raise HTTPException(status_code=404, detail="Invalid invite token")
        
    member_check = select(LeagueMember).where(
        LeagueMember.user_id == current_user.id,
        LeagueMember.league_id == league.id
    )
    is_member = (await db.execute(member_check)).scalar_one_or_none()
    
    if is_member:
        # If they are already a member, but they used an active token, just mark it as claimed and succeed
        if invitation:
            invitation.claimed_by = current_user.id
            invitation.claimed_at = datetime.now(timezone.utc)
            db.add(invitation)
            await db.commit()
        return {
            "message": "Already a member of this league",
            "league_id": league.id,
            "league_name": league.name,
            "tournament_id": league.tournament_id
        }
        
    membership = LeagueMember(user_id=current_user.id, league_id=league.id)
    db.add(membership)
    
    # If using new invitation system, mark it as claimed
    if invitation:
        invitation.claimed_by = current_user.id
        invitation.claimed_at = datetime.now(timezone.utc)
        db.add(invitation)
        
    await db.commit()
    return {
        "message": "Successfully joined league",
        "league_id": league.id,
        "league_name": league.name,
        "tournament_id": league.tournament_id
    }


@router.post("/{league_id}/leave", response_model=dict)
async def leave_league(
    league_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import func
    # Count how many leagues the user is in across all tournaments
    count_stmt = select(func.count(LeagueMember.id)).where(LeagueMember.user_id == current_user.id)
    count_result = await db.execute(count_stmt)
    total_leagues = count_result.scalar() or 0

    if total_leagues <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot leave your only league. You must delete your account to leave the system."
        )

    # Check if they are actually a member
    member_stmt = select(LeagueMember).where(
        LeagueMember.league_id == league_id,
        LeagueMember.user_id == current_user.id
    )
    member_result = await db.execute(member_stmt)
    membership = member_result.scalar_one_or_none()

    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")

    await db.delete(membership)
    await db.commit()
    return {"message": "Successfully left the league"}



# ---------------------------------------------------------------------------
# Custom League Logo Upload — stored as base64 data URL in the DB so it
# persists across container rebuilds without needing a volume mount.
# ---------------------------------------------------------------------------
from fastapi import UploadFile, File
import base64

_ALLOWED_MIME = {
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/gif",
}

@router.post("/{league_id}/logo", response_model=dict)
async def upload_league_logo(
    league_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a league logo and store it as a base64 data URL in the database."""
    result = await db.execute(select(League).where(League.id == league_id))
    league = result.scalar_one_or_none()
    if not league:
        raise HTTPException(status_code=404, detail="League not found")

    if league.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="You do not have permission to modify this league's logo.")

    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Only PNG, JPG, SVG, and GIF image files are allowed.")

    raw = await file.read()
    if len(raw) > 2 * 1024 * 1024:  # 2 MB hard limit
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB.")

    data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    league.logo_url = data_url
    await db.commit()

    return {"message": "Logo uploaded successfully", "logo_url": data_url}
