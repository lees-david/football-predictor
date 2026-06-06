"""
football_data.py — football-data.org v4 API client and DB integration.

Handles:
- Rate-limited async HTTP client (10 req/min free-tier limit)
- Score parsing: REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT
- Seed: map API match IDs onto existing DB fixtures; upsert teams table
- Poll: fetch FINISHED matches and apply scores to DB
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import unicodedata
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from core.config import settings
from core.database import AsyncSessionLocal
from core.redis_client import redis_client
from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.team import Team

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

BASE_URL = "https://api.football-data.org"
COMPETITION = "WC"
_RATE_LIMIT_KEY = "football_data:last_call_ts"
_MIN_CALL_INTERVAL_S = 6.5  # 10/min limit → ≥6s per call; 0.5s buffer

_STAGE_MAP: dict[str, FixtureStage] = {
    "GROUP_STAGE":    FixtureStage.group,
    "ROUND_OF_32":    FixtureStage.round_32,
    "ROUND_OF_16":    FixtureStage.round_16,
    "QUARTER_FINALS": FixtureStage.quarter_final,
    "SEMI_FINALS":    FixtureStage.semi_final,
    "THIRD_PLACE":    FixtureStage.third_place,
    "FINAL":          FixtureStage.final,
}

_GROUP_MAP: dict[str, str] = {f"GROUP_{c}": c for c in "ABCDEFGHIJKL"}


# ── HTTP client ───────────────────────────────────────────────────────────────

def _make_client() -> httpx.AsyncClient:
    if not settings.FOOTBALL_DATA_API_KEY:
        raise RuntimeError(
            "FOOTBALL_DATA_API_KEY is not set. Add it to .env to enable API sync."
        )
    return httpx.AsyncClient(
        base_url=BASE_URL,
        headers={"X-Auth-Token": settings.FOOTBALL_DATA_API_KEY},
        timeout=15.0,
    )


async def _rate_limit_guard() -> None:
    """Enforce minimum gap between calls using a Redis timestamp."""
    last_str = await redis_client.get(_RATE_LIMIT_KEY)
    if last_str:
        elapsed = time.time() - float(last_str)
        if elapsed < _MIN_CALL_INTERVAL_S:
            wait = _MIN_CALL_INTERVAL_S - elapsed
            logger.debug("Rate-limit guard: sleeping %.2f s", wait)
            await asyncio.sleep(wait)
    await redis_client.set(_RATE_LIMIT_KEY, str(time.time()), ex=120)


async def _api_get(
    path: str,
    params: dict[str, Any] | None = None,
    client: httpx.AsyncClient | None = None,
    *,
    retries: int = 3,
) -> dict:
    """
    GET a football-data.org endpoint with rate-limiting, 429 backoff, and timeout retry.
    When no client is provided one is created and closed within this call.
    """
    own_client = client is None
    _client = client if client is not None else _make_client()
    try:
        for attempt in range(retries):
            await _rate_limit_guard()
            try:
                resp = await _client.get(path, params=params)
            except httpx.TimeoutException:
                logger.warning(
                    "Timeout calling %s (attempt %d/%d)", path, attempt + 1, retries
                )
                if attempt < retries - 1:
                    await asyncio.sleep(10 * (attempt + 1))
                    continue
                raise

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 65))
                logger.warning("429 Too Many Requests — backing off %d s", retry_after)
                await asyncio.sleep(retry_after)
                continue

            resp.raise_for_status()

            remaining = resp.headers.get("X-Requests-Available-Minute")
            if remaining is not None and int(remaining) <= 2:
                logger.warning(
                    "API quota nearly exhausted: %s calls remaining this minute", remaining
                )

            return resp.json()

        raise RuntimeError(f"All {retries} attempts failed for {path}")
    finally:
        if own_client:
            await _client.aclose()


# ── Score parsing — pure function, no I/O ────────────────────────────────────

def _sv(obj: dict | None, *keys: str) -> int | None:
    """Extract an integer score value from a score sub-object."""
    if not obj:
        return None
    for k in keys:
        v = obj.get(k)
        if v is not None:
            return int(v)
    return None


def parse_score(score: dict) -> dict:
    """
    Map a v4 score object to canonical DB fields.

    WARNING: score.fullTime is unreliable for display purposes.
      REGULAR:           fullTime == 90-min result (safe to use as fallback)
      EXTRA_TIME:        fullTime == regularTime + extraTime goals (cumulative)
      PENALTY_SHOOTOUT:  fullTime == regularTime + extraTime + penalty count
                         e.g. a 1-1 AET match won 6-5 on pens → fullTime = 7-6

    Always derive the display score from regularTime / extraTime / penalties
    directly; never display fullTime when duration != REGULAR.

    Returns a dict with keys:
      home_score, away_score           — goals at 90 min
      home_score_aet, away_score_aet   — goals at 120 min (None if no ET)
      home_pens, away_pens             — penalty shootout scores (None if no shootout)
      match_duration                   — REGULAR / EXTRA_TIME / PENALTY_SHOOTOUT
      winner                           — HOME_TEAM / AWAY_TEAM / DRAW / None
    """
    duration = score.get("duration") or "REGULAR"
    winner   = score.get("winner")

    full = score.get("fullTime")  or {}
    reg  = score.get("regularTime") or {}
    et   = score.get("extraTime")   or {}
    pens = score.get("penalties")   or {}

    # Support both v4 'home'/'away' and legacy 'homeTeam'/'awayTeam' key names
    _h = lambda d: _sv(d, "home", "homeTeam")
    _a = lambda d: _sv(d, "away", "awayTeam")

    if duration == "REGULAR":
        h90 = _h(reg) if reg else None
        a90 = _a(reg) if reg else None
        # regularTime may be absent when the match ends at 90 min
        if h90 is None:
            h90, a90 = _h(full), _a(full)
        return dict(
            home_score=h90, away_score=a90,
            home_score_aet=None, away_score_aet=None,
            home_pens=None, away_pens=None,
            match_duration="REGULAR", winner=winner,
        )

    elif duration == "EXTRA_TIME":
        h90, a90 = _h(reg), _a(reg)
        het = _h(et) or 0
        aet_ = _a(et) or 0
        return dict(
            home_score=h90, away_score=a90,
            home_score_aet=(h90 + het) if h90 is not None else None,
            away_score_aet=(a90 + aet_) if a90 is not None else None,
            home_pens=None, away_pens=None,
            match_duration="EXTRA_TIME", winner=winner,
        )

    else:  # PENALTY_SHOOTOUT
        h90, a90 = _h(reg), _a(reg)
        het = _h(et) or 0
        aet_ = _a(et) or 0
        return dict(
            home_score=h90, away_score=a90,
            home_score_aet=(h90 + het) if h90 is not None else None,
            away_score_aet=(a90 + aet_) if a90 is not None else None,
            home_pens=_h(pens), away_pens=_a(pens),
            match_duration="PENALTY_SHOOTOUT", winner=winner,
        )


# ── Team name normalisation ───────────────────────────────────────────────────

# Maps known Wikipedia/seed name variants → football-data.org canonical names.
# Applied before normalisation so both sides collapse to the same string.
_TEAM_NAME_ALIASES: dict[str, str] = {
    "czech republic":          "czechia",
    "bosnia and herzegovina":  "bosnia-herzegovina",
    "cape verde":              "cape verde islands",
    "dr congo":                "congo dr",
    "democratic republic of congo": "congo dr",
    "republic of ireland":     "ireland",
    "north macedonia":         "macedonia",
}


def _norm(name: str | None) -> str:
    """ASCII-fold + lowercase + strip non-alphanumeric for fuzzy team name matching.

    Applies _TEAM_NAME_ALIASES first so Wikipedia/seed name variants and
    football-data.org API names collapse to the same normalised string.
    """
    if not name:
        return ""
    lowered = name.strip().lower()
    lowered = _TEAM_NAME_ALIASES.get(lowered, lowered)
    nfkd = unicodedata.normalize("NFKD", lowered)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_str)


def _is_placeholder(name: str) -> bool:
    low = name.lower()
    return (
        any(x in low for x in ["placeholder", "winner", "loser", "match", "runner", "quarterfinal", "r32", "r16", "qf", "sf", "tbd"])
        or ("home" in low and any(c.isdigit() for c in low))
        or ("away" in low and any(c.isdigit() for c in low))
    )


# ── Seed: teams ───────────────────────────────────────────────────────────────

async def seed_teams(tournament_id: int, *, client: httpx.AsyncClient | None = None) -> int:
    """
    Fetch GET /v4/competitions/WC/teams and upsert into the teams table.
    Returns the number of rows processed.
    """
    logger.info("Seeding teams for tournament %d", tournament_id)
    data = await _api_get(f"/v4/competitions/{COMPETITION}/teams", client=client)
    teams_data = data.get("teams", [])
    logger.info("API returned %d teams", len(teams_data))

    count = 0
    async with AsyncSessionLocal() as db:
        for t in teams_data:
            tid = t.get("id")
            if not tid:
                continue
            stmt = (
                pg_insert(Team)
                .values(
                    tournament_id=tournament_id,
                    data_source_team_id=tid,
                    name=t.get("name") or t.get("shortName") or "",
                    tla=t.get("tla"),
                    crest_url=t.get("crest"),
                )
                .on_conflict_do_update(
                    index_elements=["data_source_team_id"],
                    set_=dict(
                        tournament_id=tournament_id,
                        name=t.get("name") or t.get("shortName") or "",
                        tla=t.get("tla"),
                        crest_url=t.get("crest"),
                    ),
                )
            )
            await db.execute(stmt)
            count += 1
        await db.commit()

    logger.info("Upserted %d teams", count)
    return count


# ── Seed: map API match IDs onto existing fixtures ────────────────────────────

async def map_fixture_ids(tournament_id: int, *, client: httpx.AsyncClient | None = None) -> int:
    """
    Fetch GET /v4/competitions/WC/matches and populate data_source_match_id on
    existing fixtures by matching on stage + group + matchday + home team name.
    Also backfills real team names and crest URLs.

    Matching strategy:
      Group stage  → (stage, group_code, matchday, normalised home team name)
      KO stage     → (stage, kickoff date) + positional ordering within bucket

    Idempotent: fixtures that already have data_source_match_id are skipped.
    Returns the number of fixtures newly mapped.
    """
    logger.info("Mapping API match IDs onto fixtures for tournament %d", tournament_id)
    data = await _api_get(f"/v4/competitions/{COMPETITION}/matches", client=client)
    api_matches = data.get("matches", [])
    logger.info("API returned %d matches", len(api_matches))

    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Fixture).where(Fixture.tournament_id == tournament_id)
        )
        db_fixtures = res.scalars().all()

    already_mapped: set[int] = {
        f.data_source_match_id for f in db_fixtures if f.data_source_match_id
    }

    # Group-stage index: (stage, group_code, matchday, home_norm) → Fixture
    group_index: dict[tuple, Fixture] = {}
    for f in db_fixtures:
        if f.stage == FixtureStage.group and f.data_source_match_id is None:
            key = (f.stage, f.group_code, f.matchday, _norm(f.home_team))
            group_index[key] = f

    # KO index: (stage, kickoff_date) → list[Fixture] sorted by kickoff_time
    ko_index: dict[tuple, list[Fixture]] = {}
    for f in db_fixtures:
        if f.stage != FixtureStage.group and f.data_source_match_id is None:
            dk = (f.stage, f.kickoff_time.date())
            ko_index.setdefault(dk, []).append(f)
    for lst in ko_index.values():
        lst.sort(key=lambda f: f.kickoff_time)

    ko_cursor: dict[tuple, int] = {}  # tracks how many KO matches consumed per bucket

    updates: list[dict] = []

    for m in api_matches:
        api_id = m.get("id")
        if not api_id or api_id in already_mapped:
            continue

        db_stage = _STAGE_MAP.get(m.get("stage", ""))
        if db_stage is None:
            logger.debug("Unknown stage %r in API match %s — skipping", m.get("stage"), api_id)
            continue

        group_code   = _GROUP_MAP.get(m.get("group") or "")
        matchday     = m.get("matchday")
        home_obj     = m.get("homeTeam") or {}
        away_obj     = m.get("awayTeam") or {}
        home_name    = home_obj.get("name") or ""
        away_name    = away_obj.get("name") or ""
        home_crest   = home_obj.get("crest") or ""
        away_crest   = away_obj.get("crest") or ""

        utc_str = m.get("utcDate", "")
        try:
            api_kickoff: datetime | None = datetime.fromisoformat(
                utc_str.replace("Z", "+00:00")
            )
        except (ValueError, AttributeError):
            api_kickoff = None

        matched: Fixture | None = None

        if db_stage == FixtureStage.group:
            key = (db_stage, group_code, matchday, _norm(home_name))
            matched = group_index.pop(key, None)
            if matched is None and group_code:
                # Fallback: match by group + home team without matchday
                for k in list(group_index):
                    if k[0] == db_stage and k[1] == group_code and k[3] == _norm(home_name):
                        matched = group_index.pop(k)
                        break
        else:
            if api_kickoff:
                dk = (db_stage, api_kickoff.date())
                candidates = ko_index.get(dk, [])
                idx = ko_cursor.get(dk, 0)
                if idx < len(candidates):
                    matched = candidates[idx]
                    ko_cursor[dk] = idx + 1

        if matched is None:
            logger.debug(
                "No DB fixture matched API match %d (%s vs %s, %s)",
                api_id, home_name, away_name, m.get("stage"),
            )
            continue

        upd: dict = {"data_source_match_id": api_id}

        # Backfill team names: always update group stage; update KO only if real name known
        if home_name and (db_stage == FixtureStage.group or not _is_placeholder(home_name)):
            upd["home_team"] = home_name
        if away_name and (db_stage == FixtureStage.group or not _is_placeholder(away_name)):
            upd["away_team"] = away_name
        if home_crest:
            upd["home_logo"] = home_crest
        if away_crest:
            upd["away_logo"] = away_crest
        if api_kickoff:
            upd["kickoff_time"] = api_kickoff

        updates.append((matched.id, upd))

    if updates:
        async with AsyncSessionLocal() as db:
            for fixture_id, vals in updates:
                await db.execute(
                    update(Fixture).where(Fixture.id == fixture_id).values(**vals)
                )
            await db.commit()

    logger.info("Mapped %d fixtures to API match IDs", len(updates))
    return len(updates)


# ── Poll: fetch FINISHED matches and apply scores ─────────────────────────────

async def fetch_and_apply_results(
    tournament_id: int,
    *,
    client: httpx.AsyncClient | None = None,
) -> list[int]:
    """
    Fetch GET /v4/competitions/WC/matches?status=FINISHED and apply scores to
    all matched DB fixtures that are not yet marked completed.

    Returns a list of fixture IDs that transitioned to completed in this call.
    Idempotent: already-completed fixtures are skipped without being re-written.
    """
    logger.info("Polling FINISHED matches for tournament %d", tournament_id)
    data = await _api_get(
        f"/v4/competitions/{COMPETITION}/matches",
        params={"status": "FINISHED"},
        client=client,
    )
    api_matches = data.get("matches", [])
    logger.info("API returned %d FINISHED matches", len(api_matches))

    if not api_matches:
        return []

    # Load fixtures that have been mapped to API IDs
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Fixture).where(
                Fixture.tournament_id == tournament_id,
                Fixture.data_source_match_id.isnot(None),
            )
        )
        by_api_id: dict[int, Fixture] = {
            f.data_source_match_id: f for f in res.scalars().all()
        }

    newly_completed: list[int] = []

    async with AsyncSessionLocal() as db:
        for m in api_matches:
            api_id = m.get("id")
            fixture = by_api_id.get(api_id)
            if fixture is None:
                logger.debug("No mapped fixture for API match %d — skipping", api_id)
                continue

            if fixture.status == FixtureStatus.completed:
                continue  # already graded; nothing to do

            score_obj = m.get("score") or {}
            parsed = parse_score(score_obj)
            winner_tag = parsed.pop("winner")

            if parsed["home_score"] is None or parsed["away_score"] is None:
                logger.debug("Match %d has no score yet — skipping", api_id)
                continue

            # Derive knockout_winner from score.winner field + current team names
            knockout_winner: str | None = None
            if fixture.stage != FixtureStage.group and winner_tag:
                if winner_tag == "HOME_TEAM":
                    knockout_winner = fixture.home_team
                elif winner_tag == "AWAY_TEAM":
                    knockout_winner = fixture.away_team

            # Backfill real KO team names now that the match has been played
            home_obj = m.get("homeTeam") or {}
            away_obj = m.get("awayTeam") or {}
            home_name = home_obj.get("name") or fixture.home_team
            away_name = away_obj.get("name") or fixture.away_team
            home_crest = home_obj.get("crest") or fixture.home_logo
            away_crest = away_obj.get("crest") or fixture.away_logo

            await db.execute(
                update(Fixture)
                .where(Fixture.id == fixture.id)
                .values(
                    status=FixtureStatus.completed,
                    home_team=home_name,
                    away_team=away_name,
                    home_logo=home_crest,
                    away_logo=away_crest,
                    home_score=parsed["home_score"],
                    away_score=parsed["away_score"],
                    home_score_aet=parsed["home_score_aet"],
                    away_score_aet=parsed["away_score_aet"],
                    home_pens=parsed["home_pens"],
                    away_pens=parsed["away_pens"],
                    match_duration=parsed["match_duration"],
                    knockout_winner=knockout_winner,
                )
            )
            newly_completed.append(fixture.id)
            logger.info(
                "Fixture %d (%s v %s) completed: %d-%d [%s]",
                fixture.id, home_name, away_name,
                parsed["home_score"], parsed["away_score"],
                parsed["match_duration"],
            )

        if newly_completed:
            await db.commit()

    return newly_completed
