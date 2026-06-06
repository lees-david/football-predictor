"""Redis-backed IP rate limiter, exposed as a FastAPI dependency factory.

Usage:

    from core.rate_limit import rate_limit

    @router.post("/login", dependencies=[Depends(rate_limit("auth_login"))])
    async def login(...): ...
"""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from core.redis_client import redis_client


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def rate_limit(prefix: str, *, max_requests: int = 5, window_seconds: int = 60):
    """Return a dependency that enforces max_requests per window_seconds per IP for `prefix`.

    Counter key: `ratelimit:{prefix}:{ip}`. Expiry is set on first increment so the window slides.
    """

    async def _dep(request: Request) -> None:
        ip = _client_ip(request)
        key = f"ratelimit:{prefix}:{ip}"
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, window_seconds)
        if count > max_requests:
            ttl = await redis_client.ttl(key)
            retry_after = ttl if ttl and ttl > 0 else window_seconds
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Try again in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )

    return _dep
