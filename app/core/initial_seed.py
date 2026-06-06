"""
initial_seed.py — Localized scraping seeder for World Cup 2026.

Scrapes fixtures, groups, stadium venues, kickoff dates, and match scorelines
directly from Wikipedia using BeautifulSoup and requests. Bypasses API-Football
completely, saving API quota while populating all 104 fixtures idempotently.
Features an embedded pre-compiled catalog as a resilient offline fallback.

Usage (inside Docker container):
    python core/initial_seed.py [--tournament-id 1] [--season 2026]
"""
from __future__ import annotations

import os
import sys
import re
import json
import argparse
import logging
from datetime import datetime, timedelta, timezone

# Ensure parent directory is in PYTHONPATH for direct execution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests
from bs4 import BeautifulSoup
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.fixture import Fixture, FixtureStatus, FixtureStage
from models.tournament import Tournament

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Embedded Resilient Static Catalog (All 104 Matches)
# ---------------------------------------------------------------------------

VENUES = [
    "BC Place, Vancouver", "BMO Field, Toronto", "Estadio Azteca, Mexico City",
    "Estadio BBVA, Monterrey", "Estadio Akron, Guadalajara", "Lumen Field, Seattle",
    "Levi's Stadium, San Francisco", "SoFi Stadium, Los Angeles", "NRG Stadium, Houston",
    "AT&T Stadium, Dallas", "Arrowhead Stadium, Kansas City", "Mercedes-Benz Stadium, Atlanta",
    "Hard Rock Stadium, Miami", "Gillette Stadium, Boston", "Lincoln Financial Field, Philadelphia",
    "MetLife Stadium, New York/New Jersey"
]

def _generate_fallback_fixtures() -> list[dict]:
    fixtures = []
    
    # 1. Group Stage (Matches 1-72)
    # 12 Groups (A to L), 4 teams per group, 6 matches per group
    groups = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]
    hosts = {
        "A": ["Canada", "A2", "A3", "A4"],
        "B": ["Mexico", "B2", "B3", "B4"],
        "C": ["United States", "C2", "C3", "C4"],
    }
    
    match_num = 1
    for g_idx, g in enumerate(groups):
        teams = hosts.get(g, [f"{g}1", f"{g}2", f"{g}3", f"{g}4"])
        matchups = [
            (teams[0], teams[1], 1),
            (teams[2], teams[3], 1),
            (teams[3], teams[1], 2),
            (teams[0], teams[2], 2),
            (teams[3], teams[0], 3),
            (teams[1], teams[2], 3),
        ]
        for m_idx, (home, away, matchday) in enumerate(matchups):
            is_second_match = 1 if m_idx % 2 == 1 else 0
            idx_in_md = g_idx * 2 + is_second_match
            
            if matchday == 1:
                start_dt = datetime(2026, 6, 11, 10, 0, tzinfo=timezone.utc)
                days_span = 6
            elif matchday == 2:
                start_dt = datetime(2026, 6, 17, 10, 0, tzinfo=timezone.utc)
                days_span = 6
            else:
                start_dt = datetime(2026, 6, 23, 10, 0, tzinfo=timezone.utc)
                days_span = 5
                
            day_offset = (idx_in_md * days_span) // 24
            hour_offset = (idx_in_md % 3) * 3
            kickoff = start_dt + timedelta(days=day_offset, hours=hour_offset)
            
            fixtures.append({
                "external_id": f"wc2026-m{match_num}",
                "stage": FixtureStage.group,
                "group_code": g,
                "matchday": matchday,
                "home_team": home,
                "away_team": away,
                "home_logo": None,
                "away_logo": None,
                "kickoff_time": kickoff,
                "venue": VENUES[match_num % len(VENUES)],
                "home_score": None,
                "away_score": None,
                "status": FixtureStatus.scheduled
            })
            match_num += 1

    # 2. Round of 32 (Matches 73-88)
    r32_pairs = [
        ("Runner-up Group A", "Runner-up Group B"),       # Match 73
        ("Winner Group C", "Runner-up Group F"),          # Match 74
        ("Winner Group E", "3rd Group A/B/C/D/F"),        # Match 75
        ("Winner Group F", "Runner-up Group C"),          # Match 76
        ("Runner-up Group E", "Runner-up Group I"),       # Match 77
        ("Winner Group I", "3rd Group C/D/F/G/H"),        # Match 78
        ("Winner Group A", "3rd Group C/E/F/H/I"),        # Match 79
        ("Winner Group L", "3rd Group E/H/I/J/K"),        # Match 80
        ("Winner Group G", "3rd Group A/E/H/I/J"),        # Match 81
        ("Winner Group D", "3rd Group B/E/F/I/J"),        # Match 82
        ("Winner Group H", "Runner-up Group J"),          # Match 83
        ("Runner-up Group K", "Runner-up Group L"),       # Match 84
        ("Winner Group B", "3rd Group E/F/G/I/J"),        # Match 85
        ("Runner-up Group D", "Runner-up Group G"),       # Match 86
        ("Winner Group J", "Runner-up Group H"),          # Match 87
        ("Winner Group K", "3rd Group D/E/I/J/L"),        # Match 88
    ]
    r32_start = datetime(2026, 6, 28, 18, 0, tzinfo=timezone.utc)
    for i, (home, away) in enumerate(r32_pairs):
        kickoff = r32_start + timedelta(days=(i // 4), hours=((i % 4) * 3))
        fixtures.append({
            "external_id": f"wc2026-m{match_num}",
            "stage": FixtureStage.round_32,
            "group_code": None,
            "matchday": None,
            "home_team": home,
            "away_team": away,
            "home_logo": None,
            "away_logo": None,
            "kickoff_time": kickoff,
            "venue": VENUES[match_num % len(VENUES)],
            "home_score": None,
            "away_score": None,
            "status": FixtureStatus.scheduled
        })
        match_num += 1

    # 3. Round of 16 (Matches 89-96)
    r16_pairs = [
        ("Winner Match 73", "Winner Match 75"),  # Match 89
        ("Winner Match 74", "Winner Match 77"),  # Match 90
        ("Winner Match 76", "Winner Match 78"),  # Match 91
        ("Winner Match 79", "Winner Match 80"),  # Match 92
        ("Winner Match 83", "Winner Match 84"),  # Match 93
        ("Winner Match 81", "Winner Match 82"),  # Match 94
        ("Winner Match 86", "Winner Match 88"),  # Match 95
        ("Winner Match 85", "Winner Match 87"),  # Match 96
    ]
    r16_start = datetime(2026, 7, 2, 18, 0, tzinfo=timezone.utc)
    for i, (home, away) in enumerate(r16_pairs):
        kickoff = r16_start + timedelta(days=(i // 3), hours=((i % 3) * 4))
        fixtures.append({
            "external_id": f"wc2026-m{match_num}",
            "stage": FixtureStage.round_16,
            "group_code": None,
            "matchday": None,
            "home_team": home,
            "away_team": away,
            "home_logo": None,
            "away_logo": None,
            "kickoff_time": kickoff,
            "venue": VENUES[match_num % len(VENUES)],
            "home_score": None,
            "away_score": None,
            "status": FixtureStatus.scheduled
        })
        match_num += 1

    # 4. Quarter-finals (Matches 97-100)
    qf_start = datetime(2026, 7, 5, 18, 0, tzinfo=timezone.utc)
    for i in range(4):
        kickoff = qf_start + timedelta(days=(i // 2), hours=((i % 2) * 5))
        fixtures.append({
            "external_id": f"wc2026-m{match_num}",
            "stage": FixtureStage.quarter_final,
            "group_code": None,
            "matchday": None,
            "home_team": f"Winner Match {88 + i*2 + 1}",
            "away_team": f"Winner Match {88 + i*2 + 2}",
            "home_logo": None,
            "away_logo": None,
            "kickoff_time": kickoff,
            "venue": VENUES[match_num % len(VENUES)],
            "home_score": None,
            "away_score": None,
            "status": FixtureStatus.scheduled
        })
        match_num += 1

    # 5. Semi-finals (Matches 101-102)
    sf_start = datetime(2026, 7, 8, 18, 0, tzinfo=timezone.utc)
    for i in range(2):
        kickoff = sf_start + timedelta(days=0, hours=i*5)
        fixtures.append({
            "external_id": f"wc2026-m{match_num}",
            "stage": FixtureStage.semi_final,
            "group_code": None,
            "matchday": None,
            "home_team": f"Winner Quarterfinal {i*2 + 1}",
            "away_team": f"Winner Quarterfinal {i*2 + 2}",
            "home_logo": None,
            "away_logo": None,
            "kickoff_time": kickoff,
            "venue": VENUES[match_num % len(VENUES)],
            "home_score": None,
            "away_score": None,
            "status": FixtureStatus.scheduled
        })
        match_num += 1

    # 6. Third-place Playoff (Match 103)
    fixtures.append({
        "external_id": "wc2026-m103",
        "stage": FixtureStage.third_place,
        "group_code": None,
        "matchday": None,
        "home_team": "Loser Match 101",
        "away_team": "Loser Match 102",
        "home_logo": None,
        "away_logo": None,
        "kickoff_time": datetime(2026, 7, 11, 18, 0, tzinfo=timezone.utc),
        "venue": "Hard Rock Stadium, Miami",
        "home_score": None,
        "away_score": None,
        "status": FixtureStatus.scheduled
    })

    # 7. Final (Match 104)
    fixtures.append({
        "external_id": "wc2026-m104",
        "stage": FixtureStage.final,
        "group_code": None,
        "matchday": None,
        "home_team": "Winner Match 101",
        "away_team": "Winner Match 102",
        "home_logo": None,
        "away_logo": None,
        "kickoff_time": datetime(2026, 7, 12, 19, 0, tzinfo=timezone.utc),
        "venue": "MetLife Stadium, New York/New Jersey",
        "home_score": None,
        "away_score": None,
        "status": FixtureStatus.scheduled
    })

    return fixtures


# ---------------------------------------------------------------------------
# Wikipedia Scraper Module
# ---------------------------------------------------------------------------

def is_placeholder_name(name: str) -> bool:
    low = name.lower()
    return any(x in low for x in ["match", "placeholder", "winner", "loser", "runner", "group"])


_last_scrape_error: str | None = None


def scrape_wikipedia_fixtures(url: str = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup") -> list[dict]:
    global _last_scrape_error
    _last_scrape_error = None
    logger.info("Connecting to Wikipedia dynamic parser: %s", url)
    scraped = []
    try:
        r = requests.get(url, headers={"User-Agent": "FootballPredictorScraper/1.0"}, timeout=15)
        if r.status_code != 200:
            _last_scrape_error = f"Wikipedia returned HTTP {r.status_code}"
            logger.warning("Wikipedia returned status code: %d", r.status_code)
            return []
        
        soup = BeautifulSoup(r.text, 'html.parser')
        boxes = soup.find_all(class_=re.compile("footballbox|vevent"))
        logger.info("Found %d footballbox/vevent elements on the page.", len(boxes))
        
        for idx, box in enumerate(boxes):
            try:
                # 1. Parse home & away teams
                home = box.find(class_=re.compile("fhome|home"))
                away = box.find(class_=re.compile("faway|away"))
                score_el = box.find(class_=re.compile("fscore|score"))
                
                if not home or not away:
                    continue
                
                home_team = home.get_text(strip=True)
                away_team = away.get_text(strip=True)
                
                # Extract flag logos from image tags inside home/away
                home_img = home.find("img")
                away_img = away.find("img")
                
                home_logo = None
                away_logo = None
                
                if home_img and home_img.get("src"):
                    src = home_img.get("src")
                    if src.startswith("//"):
                        home_logo = "https:" + src
                    elif src.startswith("/"):
                        home_logo = "https://en.wikipedia.org" + src
                    else:
                        home_logo = src
                        
                if away_img and away_img.get("src"):
                    src = away_img.get("src")
                    if src.startswith("//"):
                        away_logo = "https:" + src
                    elif src.startswith("/"):
                        away_logo = "https://en.wikipedia.org" + src
                    else:
                        away_logo = src
                
                # Clean flags/spans or numbers from team names only if NOT placeholders
                if not is_placeholder_name(home_team):
                    home_team = re.sub(r'[\d\+\s]+$', '', home_team).strip()
                if not is_placeholder_name(away_team):
                    away_team = re.sub(r'^\s*[\d\+\s]+', '', away_team).strip()
                
                # 2. Parse Stadium Venue & Date
                date_el = box.find(class_=re.compile("fdate|date|dtstart"))
                venue_el = box.find(class_=re.compile("fdetails|venue|location"))
                
                date_str = date_el.get_text(" ", strip=True) if date_el else ""
                venue_str = venue_el.get_text(" ", strip=True) if venue_el else "TBD Venue"
                # Strip excessive whitespace/citations
                venue_str = re.sub(r'\[\d+\]', '', venue_str).strip()
                venue_str = re.sub(r'\s+', ' ', venue_str)

                # 3. Parse score updates if match concluded
                score_str = score_el.get_text(strip=True) if score_el else ""
                score_match = re.search(r'(\d+)\s*[–\-:\u2013]\s*(\d+)', score_str)
                
                home_score = None
                away_score = None
                status = FixtureStatus.scheduled
                
                if score_match:
                    home_score = int(score_match.group(1))
                    away_score = int(score_match.group(2))
                    status = FixtureStatus.completed
                
                scraped.append({
                    "home_team": home_team,
                    "away_team": away_team,
                    "home_logo": home_logo,
                    "away_logo": away_logo,
                    "home_score": home_score,
                    "away_score": away_score,
                    "status": status,
                    "venue": venue_str,
                    "date_raw": date_str
                })
            except Exception as ex:
                logger.debug("Failed parsing row index %d: %s", idx, ex)
    except Exception as ex:
        _last_scrape_error = str(ex)
        logger.exception("Error executing BeautifulSoup scraper: %s", ex)

    return scraped


# ---------------------------------------------------------------------------
# Core Synchronization Logic
# ---------------------------------------------------------------------------

async def seed(
    tournament_id: int = 1,
    season: int = 2026,
    dry_run: bool = False,
) -> dict:
    logger.info("=" * 60)
    logger.info("Football Predictor — Wikipedia Seed Engine")
    logger.info(f"Tournament ID : {tournament_id} | Season: {season}")
    logger.info("=" * 60)

    # 1. Fetch fallbacks
    catalog = _generate_fallback_fixtures()
    logger.info("Baseline catalog initialized with %d standard fixtures.", len(catalog))
    
    # 2. Try scraping
    wiki_fixtures = scrape_wikipedia_fixtures()
    logger.info("Dynamic scrape returned %d fixtures.", len(wiki_fixtures))
    
    # Check if there are completed matches in the database (Live mode)
    db_has_completed_matches = False
    try:
        async with AsyncSessionLocal() as db_check:
            stmt_comp = select(Fixture.id).where(
                Fixture.tournament_id == tournament_id,
                Fixture.status == FixtureStatus.completed
            )
            res_comp = await db_check.execute(stmt_comp)
            db_has_completed_matches = res_comp.first() is not None
    except Exception as check_ex:
        logger.warning("Could not check completed matches: %s. Defaulting to False.", check_ex)
        
    logger.info("Database has completed matches (Live Updates Mode): %s", db_has_completed_matches)
    
    # 3. Merge parsed details over baseline catalog
    merged_count = 0
    score_updates_count = 0
    for idx, base in enumerate(catalog):
        if idx < len(wiki_fixtures):
            scraped = wiki_fixtures[idx]
            
            is_knockout = base["stage"] != FixtureStage.group
            
            # If group stage, we always merge team names.
            # If knockout stage, we only map concrete teams if:
            # - We are updating a live tournament (i.e. db_has_completed_matches is True), or
            # - The scraped home/away team name itself is a placeholder string.
            # Otherwise, we retain the pristine placeholder (Winner Match, etc.).
            should_merge_home = (
                not is_knockout 
                or db_has_completed_matches 
                or is_placeholder_name(scraped["home_team"])
            )
            should_merge_away = (
                not is_knockout 
                or db_has_completed_matches 
                or is_placeholder_name(scraped["away_team"])
            )

            if should_merge_home and scraped["home_team"]:
                base["home_team"] = scraped["home_team"]
            if should_merge_away and scraped["away_team"]:
                base["away_team"] = scraped["away_team"]
                
            # Merge scraped country flag logos
            if scraped.get("home_logo"):
                base["home_logo"] = scraped["home_logo"]
            if scraped.get("away_logo"):
                base["away_logo"] = scraped["away_logo"]

            # Update scraped stadium details
            if scraped["venue"] and scraped["venue"] != "TBD Venue":
                base["venue"] = scraped["venue"]
                
            # Parse actual match scores & set to completed
            if scraped["status"] == FixtureStatus.completed:
                base["home_score"] = scraped["home_score"]
                base["away_score"] = scraped["away_score"]
                base["status"] = FixtureStatus.completed
                score_updates_count += 1
                
            merged_count += 1
            
    logger.info("Merged %d scraped matches into baseline skeleton.", merged_count)
    logger.info("Discovered %d match scores completed on Wikipedia.", score_updates_count)

    # 3.5. Strict date-sorting validator for Group stage matches
    for base in catalog:
        if base["stage"] == FixtureStage.group:
            limit_date = datetime(2026, 6, 27, 23, 59, 59, tzinfo=timezone.utc)
            if base["kickoff_time"] > limit_date:
                raise ValueError(
                    f"Strict Date Validator Error: Group match {base['external_id']} "
                    f"({base['home_team']} vs {base['away_team']}) is scheduled on "
                    f"{base['kickoff_time']} which is after June 27, 2026!"
                )

    if dry_run:
        logger.info("[DRY RUN] Skipping database writes.")
        return {"inserted": 0, "updated": merged_count, "skipped": 0, "total": len(catalog)}

    # 4. Idempotently write to PostgreSQL
    inserted = updated = skipped = 0
    async with AsyncSessionLocal() as db:
        # Verify tournament exists
        t_res = await db.execute(select(Tournament).where(Tournament.id == tournament_id))
        tournament = t_res.scalar_one_or_none()
        if tournament is None:
            logger.error("Tournament id=%d not found. Please create it first.", tournament_id)
            return {"inserted": 0, "updated": 0, "skipped": len(catalog), "total": len(catalog)}
            
        logger.info("Writing seeded fixtures to tournament: '%s'…", tournament.name)
        
        for base in catalog:

            try:
                # PostgreSQL upsert (ON CONFLICT external_id DO UPDATE)
                stage_val = base["stage"].value if hasattr(base["stage"], "value") else base["stage"]
                
                # Use begin_nested() SAVEPOINT so database exceptions on one match do not abort the transaction
                async with db.begin_nested():
                    stmt = (
                        pg_insert(Fixture)
                        .values(
                            external_id=base["external_id"],
                            tournament_id=tournament_id,
                            stage=stage_val,
                            group_code=base["group_code"],
                            matchday=base["matchday"],
                            home_team=base["home_team"],
                            home_logo=base["home_logo"],
                            away_team=base["away_team"],
                            away_logo=base["away_logo"],
                            kickoff_time=base["kickoff_time"],
                            home_score=base["home_score"],
                            away_score=base["away_score"],
                            home_score_aet=None,
                            away_score_aet=None,
                            knockout_winner=None,
                            status=base["status"],
                            venue=base["venue"],
                        )
                        .on_conflict_do_update(
                            index_elements=["external_id"],
                            set_=dict(
                                stage=stage_val,
                                group_code=base["group_code"],
                                matchday=base["matchday"],
                                home_team=base["home_team"],
                                home_logo=base["home_logo"],
                                away_team=base["away_team"],
                                away_logo=base["away_logo"],
                                kickoff_time=base["kickoff_time"],
                                home_score=base["home_score"],
                                away_score=base["away_score"],
                                status=base["status"],
                                venue=base["venue"],
                                # knockout_winner intentionally excluded: preserve manually-set values
                            ),
                        )
                        .returning(Fixture.id)
                    )
                    res = await db.execute(stmt)
                    row = res.fetchone()
                    if row:
                        inserted += 1
                    else:
                        updated += 1
            except Exception as e:
                logger.warning("Failed writing seeded match %s: %s", base["external_id"], e)
                skipped += 1
                try:
                    import traceback
                    log_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scrape_error.log"))
                    with open(log_path, "a", encoding="utf-8") as f:
                        f.write(f"=== Error seeding match {base.get('external_id')} ===\n")
                        f.write(f"Timestamp: {datetime.now()}\n")
                        f.write(f"Match data: {base}\n")
                        f.write(f"Exception: {e}\n")
                        traceback.print_exc(file=f)
                        f.write("\n" + "="*50 + "\n\n")
                except Exception as log_ex:
                    logger.error("Failed to write to scrape_error.log: %s", log_ex)
                
        await db.commit()
        
    logger.info("=" * 60)
    logger.info("Seed sequence successfully committed!")
    logger.info("  Total Inserted/Updated: %d", inserted + updated)
    logger.info("  Skipped Parse Errors  : %d", skipped)
    logger.info("  Total Loaded Fixtures : %d", len(catalog))
    logger.info("=" * 60)
    
    result = {
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "total": len(catalog),
        "api_calls_used": 0,
    }

    try:
        from core.redis_client import redis_client as _rc
        now_iso = datetime.now(timezone.utc).isoformat()
        if _last_scrape_error:
            outcome = "error"
        elif len(wiki_fixtures) > 0:
            outcome = "success"
        else:
            outcome = "fallback_only"
        await _rc.set("scraper:last_run_at", now_iso)
        await _rc.set("scraper:last_outcome", outcome)
        await _rc.set("scraper:last_stats", json.dumps({
            **result,
            "wiki_fixtures_scraped": len(wiki_fixtures),
            "score_updates": score_updates_count,
            "merged": merged_count,
        }))
        if _last_scrape_error:
            await _rc.set("scraper:last_error", _last_scrape_error)
        else:
            await _rc.delete("scraper:last_error")
    except Exception as _redis_ex:
        logger.warning("Failed to write scraper status to Redis: %s", _redis_ex)

    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Wikipedia localized scraper seeder")
    parser.add_argument("--tournament-id", type=int, default=1, help="Tournament PK ID (default: 1)")
    parser.add_argument("--season", type=int, default=2026, help="Season year (default: 2026)")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and parse but skip DB commit")
    args = parser.parse_args()

    import asyncio
    asyncio.run(
        seed(
            tournament_id=args.tournament_id,
            season=args.season,
            dry_run=args.dry_run
        )
    )
