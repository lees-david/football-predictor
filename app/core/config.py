import os
import sys
from pydantic import ValidationError, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    PROJECT_NAME: str = "World Cup Predictor"
    SECRET_KEY: str = Field(..., min_length=32)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 1 week
    DEBUG: bool = False

    # DB & Cache
    DATABASE_URL: str
    REDIS_URL: str

    # External APIs
    TRANS_EMAIL_API_KEY: str
    FOOTBALL_DATA_API_KEY: str = ""  # football-data.org v4; add to .env to enable API sync
    RESEND_WEBHOOK_SECRET: str = ""  # Optional — set to validate Resend webhook signatures

    # Public URL used in emails (no trailing slash)
    SITE_URL: str = "http://localhost:8083"

    # CORS — comma-separated list of allowed origins (e.g. "https://app.example.com,https://staging.example.com").
    # Empty string disables cross-origin requests entirely. "*" is intentionally rejected when paired with credentials.
    CORS_ALLOWED_ORIGINS: str = ""

    # Platform Settings
    # Optional override for the bracket lock time. When empty (default), the lock
    # is derived per tournament from the earliest group-stage fixture kickoff
    # (see services/tournaments.py::resolve_bracket_lock_time). Set as an ISO
    # timestamp (e.g. "2026-06-11T13:45:00Z") only if you need to force-lock
    # globally regardless of fixture data.
    TOURNAMENT_LOCK_AT: str = ""
    MAX_DIGEST_EMAILS_PER_DAY: int = 100
    MOBILE_REDIRECT_ENABLED: bool = False

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        raw = (self.CORS_ALLOWED_ORIGINS or "").strip()
        if not raw:
            return []
        return [o.strip() for o in raw.split(",") if o.strip()]


def _load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        missing = [".".join(str(p) for p in err["loc"]) for err in exc.errors() if err.get("type") == "missing"]
        other = [err for err in exc.errors() if err.get("type") != "missing"]
        sys.stderr.write("\n" + "=" * 70 + "\n")
        sys.stderr.write("CONFIGURATION ERROR: cannot start the application.\n")
        if missing:
            sys.stderr.write("\nMissing required environment variables:\n")
            for var in missing:
                sys.stderr.write(f"  - {var}\n")
            sys.stderr.write("\nSet these in your .env file (see CLAUDE.md for the full list).\n")
        if other:
            sys.stderr.write("\nInvalid configuration values:\n")
            for err in other:
                loc = ".".join(str(p) for p in err["loc"])
                sys.stderr.write(f"  - {loc}: {err.get('msg')}\n")
        sys.stderr.write("=" * 70 + "\n\n")
        sys.exit(1)


settings = _load_settings()
