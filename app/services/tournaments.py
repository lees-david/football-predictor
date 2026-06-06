"""Tournament-scoped resolution helpers shared by API routes.

`resolve_tournament_id`  — turn an optional `tournament_id` query arg into a
concrete int. Used by bracket/leagues routes that previously defaulted to
`tournament_id or 1`, which broke silently if tournament ID 1 was ever
deleted or another tournament became primary.

`resolve_bracket_lock_time` — when bracket predictions should lock for a
tournament. Prefers the tournament's earliest group-stage fixture kickoff;
falls back to `settings.TOURNAMENT_LOCK_AT` if set; otherwise returns a
far-future sentinel so a fixture-less tournament does not auto-lock once
the hardcoded date passes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.fixture import Fixture, FixtureStage
from models.tournament import Tournament

# Far-future sentinel for "no kickoff known yet, don't lock anything".
_NEVER_LOCK = datetime(2099, 12, 31, tzinfo=timezone.utc)


async def resolve_tournament_id(db: AsyncSession, tournament_id: int | None) -> int:
    """Return the requested tournament_id, or the most-recently-created active
    tournament if none was provided. Raises 404 if no active tournament exists.
    """
    if tournament_id is not None:
        return tournament_id

    res = await db.execute(
        select(Tournament.id)
        .where(Tournament.is_active.is_(True))
        .order_by(Tournament.id.desc())
        .limit(1)
    )
    t_id = res.scalar_one_or_none()
    if t_id is None:
        raise HTTPException(status_code=404, detail="No active tournament found")
    return t_id


async def resolve_bracket_lock_time(db: AsyncSession, tournament_id: int) -> datetime:
    """Bracket lock time for a tournament:
      1. Earliest group-stage kickoff for the tournament (preferred).
      2. settings.TOURNAMENT_LOCK_AT env override if set.
      3. Far-future sentinel — effectively no lock.
    """
    stmt = (
        select(Fixture.kickoff_time)
        .where(
            Fixture.tournament_id == tournament_id,
            Fixture.stage == FixtureStage.group,
        )
        .order_by(Fixture.kickoff_time.asc())
        .limit(1)
    )
    earliest = (await db.execute(stmt)).scalar_one_or_none()
    if earliest is not None:
        return earliest

    override = (settings.TOURNAMENT_LOCK_AT or "").strip()
    if override:
        return datetime.fromisoformat(override.replace("Z", "+00:00"))

    return _NEVER_LOCK
