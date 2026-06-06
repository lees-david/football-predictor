import redis.asyncio as redis
from core.config import settings

redis_client = redis.from_url(
    settings.REDIS_URL,
    encoding="utf-8",
    decode_responses=True,
    max_connections=50
)

async def close_redis() -> None:
    """Disconnect the global redis connection pool to prevent event loop mismatch errors in Celery workers."""
    await redis_client.connection_pool.disconnect()

