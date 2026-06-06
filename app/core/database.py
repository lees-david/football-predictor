import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from core.config import settings

# Rewrite URL for asyncpg if needed
db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)

# Celery workers call asyncio.run() on each task, which creates a fresh event loop
# every time. asyncpg connections are bound to the event loop that created them, so
# pooled connections from a previous asyncio.run() call are invalid in the next one
# and raise "cannot perform operation: another operation is in progress".
# Using NullPool in the worker process means connections are never reused across
# asyncio.run() boundaries — each async context gets a fresh connection.
_is_celery = os.getenv("CELERY_WORKER", "0") == "1"

engine = create_async_engine(
    db_url,
    echo=False,
    future=True,
    connect_args={
        "server_settings": {
            "statement_timeout": "30000",
            "idle_in_transaction_session_timeout": "60000",
        }
    },
    **({} if _is_celery else {"pool_size": 5, "max_overflow": 10, "pool_timeout": 5}),
    **({"poolclass": NullPool} if _is_celery else {}),
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

class Base(DeclarativeBase):
    pass
