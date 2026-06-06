import hashlib
import secrets
from datetime import timedelta, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core.redis_client import redis_client
from core.security import verify_password, get_password_hash, create_access_token
from core.config import settings
from core.rate_limit import rate_limit
from api.deps import get_db
from models.league import League
from models.league_member import LeagueMember
from models.tournament import Tournament
from models.user import User, UserRole
from models.invitation import Invitation
from schemas.user import Token, UserCreate

router = APIRouter()

# Brute-force / mass-registration guards: 5 attempts/min per IP per endpoint.
_register_rl = rate_limit("auth_register", max_requests=5, window_seconds=60)
_login_rl = rate_limit("auth_login", max_requests=5, window_seconds=60)
_forgot_rl = rate_limit("auth_forgot", max_requests=3, window_seconds=60)

_RESET_TTL = 3600  # 1 hour
_RESET_KEY_PREFIX = "password_reset:"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/register", response_model=Token, dependencies=[Depends(_register_rl)])
async def register(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # 1. Validate invite token
    # First search in invitations table (new system)
    invitation_stmt = select(Invitation).where(
        Invitation.token == user_in.invite_token,
        Invitation.is_revoked == False,
        Invitation.claimed_by.is_(None)
    )
    invitation_result = await db.execute(invitation_stmt)
    invitation = invitation_result.scalar_one_or_none()
    
    # Check if we should check expiration
    if invitation and invitation.expires_at and datetime.now(timezone.utc) > invitation.expires_at:
        invitation = None # expired
        
    league_id = None
    if invitation:
        league_id = invitation.league_id
    else:
        # Fallback to legacy League.invite_token check for backwards compatibility
        league_stmt = select(League).where(League.invite_token == user_in.invite_token, League.is_active == True)
        league_result = await db.execute(league_stmt)
        league = league_result.scalar_one_or_none()
        if league is None:
            raise HTTPException(status_code=400, detail="Invalid or inactive invite token")
        league_id = league.id

    # 2. Check if email is already registered
    stmt = select(User).where(User.email == user_in.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    # 3. Create user
    user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        display_name=user_in.display_name,
        team_name=user_in.team_name,
        role=UserRole.player,
        can_manage_leagues=False,
        can_invite_users=False
    )
    db.add(user)
    await db.flush()  # Obtain user.id before commit to add membership
    
    # 4. Auto-enroll user in the league
    membership = LeagueMember(user_id=user.id, league_id=league_id)
    db.add(membership)
    
    # If using new invitation system, mark it as claimed
    if invitation:
        invitation.claimed_by = user.id
        invitation.claimed_at = datetime.now(timezone.utc)
        db.add(invitation)

    # 5. Save email opt-in preferences
    from models.user_email_preference import UserEmailPreference
    from models.email_template import EmailType
    db.add(UserEmailPreference(user_id=user.id, email_type=EmailType.welcome, opted_in=True))
    db.add(UserEmailPreference(user_id=user.id, email_type=EmailType.daily_digest, opted_in=user_in.email_opt_in))
    db.add(UserEmailPreference(user_id=user.id, email_type=EmailType.round_summary, opted_in=user_in.email_opt_in))
        
    await db.commit()
    await db.refresh(user)

    try:
        from models.email_template import EmailType
        from services import email_service
        active_tourn_res = await db.execute(
            select(League).where(League.id == league_id)
        )
        joined_league = active_tourn_res.scalar_one_or_none()
        tournament_id = joined_league.tournament_id if joined_league else None
        tournament_name = ""
        if tournament_id:
            t_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
            t = t_res.scalar_one_or_none()
            tournament_name = t.name if t else ""
        
        site_url = await email_service.get_site_url(db)
        await email_service.send_email(
            db,
            user_id=user.id,
            to_address=user.email,
            email_type=EmailType.welcome,
            context={
                "user_name": user.display_name,
                "tournament_name": tournament_name,
                "site_url": site_url,
            },
            tournament_id=tournament_id,
        )
    except Exception:
        pass  # email failure must never block registration

    access_token = create_access_token(subject=user.id, password_hash=user.hashed_password)
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/forgot-password", status_code=200, dependencies=[Depends(_forgot_rl)])
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.email == body.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Always return 200 — don't reveal whether the email exists
    if user:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        await redis_client.set(
            f"{_RESET_KEY_PREFIX}{token_hash}",
            user.email,
            ex=_RESET_TTL,
        )
        from models.email_template import EmailType
        from services import email_service
        site_url = await email_service.get_site_url(db)
        reset_url = f"{site_url}/reset-password?token={raw_token}"
        try:
            await email_service.send_email(
                db,
                user_id=user.id,
                to_address=user.email,
                email_type=EmailType.password_reset,
                context={"reset_url": reset_url},
                bypass_hierarchy=True,
                force_live=True,
            )
        except Exception:
            pass  # never fail the request on email error

    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password", status_code=200)
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    key = f"{_RESET_KEY_PREFIX}{token_hash}"
    email = await redis_client.get(key)

    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    stmt = select(User).where(User.email == email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = get_password_hash(body.new_password)
    db.add(user)
    await db.commit()
    await redis_client.delete(key)  # single-use

    return {"message": "Password updated successfully"}


@router.post("/login", response_model=Token, dependencies=[Depends(_login_rl)])
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.email == form_data.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
        
    access_token = create_access_token(subject=user.id, password_hash=user.hashed_password)
    return {"access_token": access_token, "token_type": "bearer"}
