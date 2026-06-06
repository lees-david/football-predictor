import os
import sys
import asyncio

# Ensure parent directory is in PYTHONPATH for direct execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from core.database import AsyncSessionLocal
from models.user import User, UserRole

async def promote(email: str):
    async with AsyncSessionLocal() as session:
        stmt = select(User).where(User.email == email)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            print(f"User with email {email} not found.")
            return
        user.role = UserRole.admin
        user.can_invite_users = True
        user.can_manage_leagues = True
        await session.commit()
        print(f"Successfully promoted {email} to Administrator (with all league & invite privileges).")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python promote_user.py <email>")
        sys.exit(1)
    
    # Run the async promote function
    asyncio.run(promote(sys.argv[1]))
