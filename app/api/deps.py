from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from core.config import settings
from core.database import AsyncSessionLocal
from models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    stmt = select(User).where(User.id == int(user_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception

    # Validate password checksum claim if present
    pwd_claim = payload.get("pwd")
    if pwd_claim:
        import hashlib
        expected_pwd = hashlib.sha256(user.hashed_password.encode()).hexdigest()
        if pwd_claim != expected_pwd:
            raise credentials_exception

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    # Record active user heartbeat in Redis
    try:
        import time
        import random
        from core.redis_client import redis_client
        now = int(time.time())
        await redis_client.zadd("users:active", {str(user.id): now})
        # Prune inactive users (>10 minutes) on ~2% of requests
        if random.random() < 0.02:
            await redis_client.zremrangebyscore("users:active", "-inf", now - 600)
    except Exception:
        pass  # Never let Redis heartbeat failure block requests

    # Enforce maintenance block for players (non-admins)
    if user.role != UserRole.admin:
        from services.maintenance import is_maintenance_active
        if await is_maintenance_active(db):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="System is currently offline for scheduled maintenance. Please try again shortly."
            )
        
    return user

async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Not enough privileges")
    return current_user

async def get_current_league_manager(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin and not current_user.can_manage_leagues:
        raise HTTPException(status_code=403, detail="Not authorized to manage leagues")
    return current_user

async def get_current_inviter(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin and not current_user.can_invite_users:
        raise HTTPException(status_code=403, detail="Not authorized to invite users")
    return current_user

async def get_current_user_optional(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> User | None:
    authorization: str | None = request.headers.get("Authorization")
    if not authorization:
        return None
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1]
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
    except JWTError:
        return None

    stmt = select(User).where(User.id == int(user_id))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user and user.is_active:
        pwd_claim = payload.get("pwd")
        if pwd_claim:
            import hashlib
            expected_pwd = hashlib.sha256(user.hashed_password.encode()).hexdigest()
            if pwd_claim != expected_pwd:
                return None
        return user
    return None

