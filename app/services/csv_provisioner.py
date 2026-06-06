"""Provision users in bulk from a CSV file.

Each row runs inside its own SAVEPOINT so a duplicate email (or any other
per-row IntegrityError / validation error) is isolated to that row and does
not roll back the entire batch. The outer transaction is committed once at
the end, persisting every row that survived its own savepoint.
"""

from __future__ import annotations

import csv
import io
import logging
import secrets

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_password_hash
from models.user import User, UserRole

logger = logging.getLogger(__name__)


async def provision_users_from_csv(db: AsyncSession, csv_content: str) -> list[dict]:
    """Parse CSV content (columns: name, email) and insert one User per row.

    Returns one dict per processed row with `email`, `temp_password` (or
    `None` for non-created rows), and `status`:

      - "created"            — insert succeeded.
      - "skipped_duplicate"  — email already exists in the users table.
      - "error: <Class>"     — any other per-row failure; row is skipped and
                               the rest of the batch continues.

    Rows with empty name or email are silently skipped (not returned).
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    results: list[dict] = []

    for row in reader:
        name = (row.get("name") or "").strip()
        email = (row.get("email") or "").strip()

        if not name or not email:
            continue

        temp_password = secrets.token_urlsafe(8)
        hashed_password = get_password_hash(temp_password)

        try:
            async with db.begin_nested():
                db.add(
                    User(
                        email=email,
                        display_name=name,
                        hashed_password=hashed_password,
                        role=UserRole.player,
                    )
                )
                # Flush inside the savepoint so a unique-violation surfaces here
                # and only rolls back this row, not the whole batch.
                await db.flush()
        except IntegrityError:
            results.append({"email": email, "temp_password": None, "status": "skipped_duplicate"})
            continue
        except Exception as exc:  # pragma: no cover — defensive; unusual per-row failures
            logger.exception("Unexpected error provisioning %s: %s", email, exc)
            results.append({"email": email, "temp_password": None, "status": f"error: {exc.__class__.__name__}"})
            continue

        results.append({"email": email, "temp_password": temp_password, "status": "created"})

    await db.commit()
    return results
