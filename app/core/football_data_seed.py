"""
football_data_seed.py — One-time seed script for football-data.org integration.

Run this once after adding FOOTBALL_DATA_API_KEY to .env to:
  1. Populate the teams table from GET /v4/competitions/WC/teams
  2. Map API match IDs onto existing fixtures from GET /v4/competitions/WC/matches

The two steps together cost 2 API calls (well within the 10/min free-tier limit).
All operations are idempotent: safe to re-run.

Usage (inside Docker container, from the app/ directory):
    python core/football_data_seed.py [--tournament-id 1]
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.football_data import _make_client, seed_teams, map_fixture_ids

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def run_seed(tournament_id: int) -> None:
    logger.info("=" * 60)
    logger.info("football-data.org Seed — tournament %d", tournament_id)
    logger.info("=" * 60)

    async with _make_client() as client:
        teams_count = await seed_teams(tournament_id, client=client)
        logger.info("Step 1 complete: %d teams upserted", teams_count)

        mapped_count = await map_fixture_ids(tournament_id, client=client)
        logger.info("Step 2 complete: %d fixtures mapped to API match IDs", mapped_count)

    logger.info("=" * 60)
    logger.info("Seed complete. Run the app to verify fixture data.")
    logger.info("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed football-data.org team and match IDs")
    parser.add_argument("--tournament-id", type=int, default=1, help="Tournament PK (default: 1)")
    args = parser.parse_args()
    asyncio.run(run_seed(args.tournament_id))
