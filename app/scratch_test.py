import asyncio
import os
import sys
from datetime import datetime, timezone

# Ensure parent directory is in PATH
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from core.database import AsyncSessionLocal
from models.fixture import Fixture, FixtureStatus, FixtureStage
from sqlalchemy.dialects.postgresql import insert as pg_insert

async def test_insert():
    print("Testing insert of Quarter-final match...")
    async with AsyncSessionLocal() as db:
        stage_val = FixtureStage.quarter
        # Let's try both enum and raw value to see what fails
        try:
            stmt = (
                pg_insert(Fixture)
                .values(
                    external_id="test-qc-1",
                    tournament_id=1,
                    stage=stage_val,
                    group_code=None,
                    matchday=None,
                    home_team="Test Home",
                    away_team="Test Away",
                    kickoff_time=datetime.now(timezone.utc),
                    status=FixtureStatus.scheduled,
                )
                .on_conflict_do_update(
                    index_elements=["external_id"],
                    set_=dict(
                        stage=stage_val,
                    )
                )
            )
            await db.execute(stmt)
            await db.commit()
            print("SUCCESS with enum object!")
        except Exception as e:
            print("FAILED with enum object:", e)
            import traceback
            traceback.print_exc()

        try:
            stmt = (
                pg_insert(Fixture)
                .values(
                    external_id="test-qc-2",
                    tournament_id=1,
                    stage=stage_val.value,
                    group_code=None,
                    matchday=None,
                    home_team="Test Home",
                    away_team="Test Away",
                    kickoff_time=datetime.now(timezone.utc),
                    status=FixtureStatus.scheduled,
                )
                .on_conflict_do_update(
                    index_elements=["external_id"],
                    set_=dict(
                        stage=stage_val.value,
                    )
                )
            )
            await db.execute(stmt)
            await db.commit()
            print("SUCCESS with string value!")
        except Exception as e:
            print("FAILED with string value:", e)
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_insert())
