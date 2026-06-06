import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from api.v1.router import api_router
from core.config import settings
from core.database import AsyncSessionLocal
from core.redis_client import redis_client

logger = logging.getLogger(__name__)

app = FastAPI(title=settings.PROJECT_NAME)

class LimitUploadSizeMiddleware:
    def __init__(self, app, max_upload_size: int = 10 * 1024 * 1024, max_json_size: int = 1024 * 1024):
        self.app = app
        self.max_upload_size = max_upload_size
        self.max_json_size = max_json_size

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http" and scope["method"] in ("POST", "PUT", "PATCH"):
            path = scope.get("path", "")
            is_upload = "upload" in path or "provision" in path or "logo" in path
            limit = self.max_upload_size if is_upload else self.max_json_size

            headers = dict(scope.get("headers", []))
            content_length = headers.get(b"content-length")
            if content_length:
                try:
                    if int(content_length) > limit:
                        await send({
                            "type": "http.response.start",
                            "status": 413,
                            "headers": [(b"content-type", b"application/json")]
                        })
                        await send({
                            "type": "http.response.body",
                            "body": b'{"detail": "Payload Too Large"}',
                            "more_body": False
                        })
                        return
                except ValueError:
                    await send({
                        "type": "http.response.start",
                        "status": 400,
                        "headers": [(b"content-type", b"application/json")]
                    })
                    await send({
                        "type": "http.response.body",
                        "body": b'{"detail": "Invalid Content-Length header"}',
                        "more_body": False
                    })
                    return
        await self.app(scope, receive, send)

app.add_middleware(LimitUploadSizeMiddleware)

_cors_origins = settings.cors_origins_list
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    logger.warning(
        "CORS_ALLOWED_ORIGINS is empty — cross-origin requests will be blocked. "
        "Set the env var to a comma-separated list of allowed frontend origins."
    )

if not settings.FOOTBALL_DATA_API_KEY:
    logger.warning(
        "Live score syncing disabled — set FOOTBALL_DATA_API_KEY in your env to enable."
    )

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    checks: dict[str, str] = {"redis": "ok", "db": "ok"}
    healthy = True

    try:
        await redis_client.ping()
    except Exception as exc:
        checks["redis"] = f"error: {exc.__class__.__name__}"
        healthy = False

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception as exc:
        checks["db"] = f"error: {exc.__class__.__name__}"
        healthy = False

    status_code = 200 if healthy else 503
    return JSONResponse({"status": "ok" if healthy else "degraded", "checks": checks}, status_code=status_code)


# Fixture sync runs from Celery beat: `daily_fixture_sync` at 06:00 UTC and
# `poll_live_fixtures` every minute (see core/celery_app.py). Both iterate
# Tournament.is_active, so no boot-time seed is needed here — keeping one
# would just race across workers and hardcode tournament_id/season.


from fastapi import Request
from fastapi.responses import RedirectResponse
import re

# Serve SPA and static assets
@app.get("/{full_path:path}")
async def serve_spa(full_path: str, request: Request):
    # Don't intercept API routes
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    # Device auto-discovery and redirection for root or non-mobile paths
    if not full_path.startswith("m/") and full_path != "m":
        should_redirect = settings.MOBILE_REDIRECT_ENABLED or request.headers.get("x-enable-mobile-redirect") == "1"
        
        if should_redirect:
            user_agent = request.headers.get("user-agent", "").lower()
            force_desktop = request.cookies.get("force_desktop") == "1"
            is_mobile = bool(re.search(r"iphone|android|mobile", user_agent))
            
            if is_mobile and not force_desktop:
                # Keep query params if any
                query_string = request.url.query
                redirect_url = f"/m/{full_path}"
                if query_string:
                    redirect_url += f"?{query_string}"
                return RedirectResponse(url=redirect_url, status_code=302)

    # Determine which static directory to serve from
    is_mobile_path = full_path.startswith("m/") or full_path == "m"
    static_dir = "static_mobile" if is_mobile_path else "static"
    
    # Strip the "m/" prefix for file path resolution in static_mobile
    file_path_rel = full_path[2:] if is_mobile_path and full_path.startswith("m/") else full_path
    if is_mobile_path and full_path == "m":
        file_path_rel = ""
        
    file_path = os.path.join(static_dir, file_path_rel)
    
    # Check if the requested file exists (e.g. /assets/index.js, /favicon.ico)
    if file_path_rel and os.path.isfile(file_path):
        # Vite hashes asset filenames — they're immutable, cache aggressively.
        # Non-asset files (favicon, manifest, etc.) get a short TTL.
        if file_path_rel.startswith("assets/"):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        else:
            headers = {"Cache-Control": "public, max-age=3600"}
        return FileResponse(file_path, headers=headers)

    # Fallback to index.html for React Router
    fallback_html = os.path.join(static_dir, "index.html")
    if os.path.isfile(fallback_html):
        return FileResponse(fallback_html)
    
    return JSONResponse({"detail": "Not Found"}, status_code=404)
