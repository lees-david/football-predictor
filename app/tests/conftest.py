import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from main import app

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client

@pytest.fixture(autouse=True)
def mock_redis_global():
    """Mock Redis client globally to prevent connection failures in tests."""
    from core.redis_client import redis_client
    
    with patch.object(redis_client, "get", new_callable=AsyncMock, return_value="0"), \
         patch.object(redis_client, "set", new_callable=AsyncMock), \
         patch.object(redis_client, "delete", new_callable=AsyncMock), \
         patch.object(redis_client, "incr", new_callable=AsyncMock, return_value=1), \
         patch.object(redis_client, "expire", new_callable=AsyncMock), \
         patch.object(redis_client, "ttl", new_callable=AsyncMock, return_value=-1), \
         patch.object(redis_client, "zadd", new_callable=AsyncMock), \
         patch.object(redis_client, "zremrangebyscore", new_callable=AsyncMock), \
         patch.object(redis_client, "zcard", new_callable=AsyncMock, return_value=0), \
         patch.object(redis_client, "ping", new_callable=AsyncMock):
        yield redis_client

