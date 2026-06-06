"""
Score Integrity Audit endpoints.

GET  /admin/audit?tournament_id=1     — read-only integrity checks
POST /admin/audit/regrade/group/{group_code}?tournament_id=1  — force-regrade a group
POST /admin/audit/regrade/ko?tournament_id=1&stage=round_16   — force-regrade a KO stage
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db, get_current_admin
from models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ScoreMismatch(BaseModel):
    pred_id: int
    fixture_id: int
    fixture: str
    result: str
    knockout_winner: str | None
    display_name: str
    prediction: str
    stored_pts: int
    expected_pts: int
    delta: int


class GradingOrphan(BaseModel):
    fixture_id: int
    fixture: str
    stage: str
    result: str
    ungraded_predictions: int


class TotalPointsDrift(BaseModel):
    user_id: int
    display_name: str
    stored_total: int
    ledger_sum: int
    drift: int


class DoubleGrading(BaseModel):
    user_id: int
    display_name: str
    source_type: str
    source_id: str
    entry_count: int
    total_pts_in_dupes: int


class FixtureLedgerMismatch(BaseModel):
    fixture_id: int
    fixture: str
    stage: str
    prediction_table_pts: int
    ledger_pts: int
    delta: int


class UserBreakdown(BaseModel):
    user_id: int
    display_name: str
    stored_total: int
    match_pts: int
    group_bracket_pts: int
    ko_bracket_pts: int
    ledger_total: int


class KoCoverage(BaseModel):
    stage: str
    tournament_id: int
    completed_fixtures: int
    users_with_bracket: int
    users_with_ko_ledger_entry: int
    bracket_graded: bool


class GroupCoverage(BaseModel):
    tournament_id: int
    group_code: str
    total_fixtures: int
    completed: int
    bracket_graded: bool


class NullScoreFixture(BaseModel):
    fixture_id: int
    fixture: str
    stage: str
    status: str


class AuditSummary(BaseModel):
    completed_fixtures: int
    graded_predictions: int
    ungraded_predictions_on_completed: int
    match_ledger_rows: int
    group_bracket_ledger_rows: int
    ko_bracket_ledger_rows: int
    active_users: int
    total_pts_across_all_users: int


class AuditReport(BaseModel):
    tournament_id: int
    summary: AuditSummary
    score_mismatches: list[ScoreMismatch]
    grading_orphans: list[GradingOrphan]
    total_points_drift: list[TotalPointsDrift]
    double_grading: list[DoubleGrading]
    fixture_ledger_mismatch: list[FixtureLedgerMismatch]
    user_breakdown: list[UserBreakdown]
    ko_coverage: list[KoCoverage]
    group_coverage: list[GroupCoverage]
    null_score_completed: list[NullScoreFixture]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/audit", response_model=AuditReport)
async def run_audit(
    tournament_id: int = Query(default=1),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Run all scoring integrity checks. Read-only — no data is modified."""

    # -----------------------------------------------------------------------
    # 1. Score mismatches
    # -----------------------------------------------------------------------
    mismatch_rows = await db.execute(text("""
        WITH scored AS (
            SELECT
                mp.id                                    AS pred_id,
                mp.fixture_id,
                f.home_team || ' vs ' || f.away_team     AS fixture,
                f.home_score || '-' || f.away_score      AS result,
                f.knockout_winner,
                u.display_name,
                mp.predicted_home || '-' || mp.predicted_away AS prediction,
                mp.points_awarded                        AS stored_pts,
                CASE
                    WHEN mp.predicted_home = f.home_score
                     AND mp.predicted_away = f.away_score
                    THEN 5
                    WHEN (mp.predicted_home - mp.predicted_away)
                       = (f.home_score     - f.away_score)
                    THEN 3
                    WHEN SIGN(mp.predicted_home - mp.predicted_away)
                       = CASE
                           WHEN f.knockout_winner IS NOT NULL THEN
                               CASE WHEN f.knockout_winner = f.home_team THEN  1
                                    WHEN f.knockout_winner = f.away_team THEN -1
                                    ELSE 0 END
                           ELSE SIGN(f.home_score - f.away_score)
                         END
                    THEN 2
                    ELSE 0
                END AS expected_pts
            FROM match_predictions mp
            JOIN fixtures f ON f.id = mp.fixture_id
            JOIN users    u ON u.id = mp.user_id
            WHERE f.tournament_id = :tid
              AND f.status = 'completed'
              AND f.home_score IS NOT NULL
              AND f.away_score IS NOT NULL
        )
        SELECT pred_id, fixture_id, fixture, result, knockout_winner,
               display_name, prediction, stored_pts, expected_pts,
               stored_pts - expected_pts AS delta
        FROM scored
        WHERE stored_pts <> expected_pts
        ORDER BY ABS(stored_pts - expected_pts) DESC, fixture_id, display_name
    """), {"tid": tournament_id})

    score_mismatches = [
        ScoreMismatch(**dict(row._mapping)) for row in mismatch_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 2. Grading orphans
    # -----------------------------------------------------------------------
    orphan_rows = await db.execute(text("""
        SELECT
            f.id                                     AS fixture_id,
            f.home_team || ' vs ' || f.away_team     AS fixture,
            f.stage::text                            AS stage,
            f.home_score || '-' || f.away_score      AS result,
            COUNT(mp.id)                             AS ungraded_predictions
        FROM fixtures f
        JOIN match_predictions mp ON mp.fixture_id = f.id
        WHERE f.tournament_id = :tid
          AND f.status = 'completed'
          AND mp.points_awarded = 0
          AND mp.is_locked = FALSE
        GROUP BY f.id, f.home_team, f.away_team, f.stage, f.home_score, f.away_score
        ORDER BY f.id
    """), {"tid": tournament_id})

    grading_orphans = [
        GradingOrphan(**dict(row._mapping)) for row in orphan_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 3. User total_points vs ledger sum
    # -----------------------------------------------------------------------
    drift_rows = await db.execute(text("""
        SELECT
            u.id                                           AS user_id,
            u.display_name,
            u.total_points                                 AS stored_total,
            COALESCE(SUM(l.points_awarded), 0)::int        AS ledger_sum,
            (u.total_points - COALESCE(SUM(l.points_awarded), 0))::int AS drift
        FROM users u
        LEFT JOIN user_points_ledger l ON l.user_id = u.id
        GROUP BY u.id, u.display_name, u.total_points
        HAVING u.total_points <> COALESCE(SUM(l.points_awarded), 0)
        ORDER BY ABS(u.total_points - COALESCE(SUM(l.points_awarded), 0)) DESC
    """), {})

    total_points_drift = [
        TotalPointsDrift(**dict(row._mapping)) for row in drift_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 4. Double-grading (duplicate ledger entries)
    # -----------------------------------------------------------------------
    dupe_rows = await db.execute(text("""
        SELECT
            l.user_id,
            u.display_name,
            l.source_type::text                  AS source_type,
            l.source_id,
            COUNT(*)::int                        AS entry_count,
            SUM(l.points_awarded)::int           AS total_pts_in_dupes
        FROM user_points_ledger l
        JOIN users u ON u.id = l.user_id
        WHERE l.tournament_id = :tid
        GROUP BY l.user_id, u.display_name, l.source_type, l.source_id
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, l.user_id
    """), {"tid": tournament_id})

    double_grading = [
        DoubleGrading(**dict(row._mapping)) for row in dupe_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 5. Fixture prediction sum vs ledger sum
    # -----------------------------------------------------------------------
    ledger_mismatch_rows = await db.execute(text("""
        WITH pred_totals AS (
            SELECT
                mp.fixture_id,
                SUM(mp.points_awarded)::int AS pred_sum
            FROM match_predictions mp
            JOIN fixtures f ON f.id = mp.fixture_id
            WHERE f.tournament_id = :tid AND f.status = 'completed'
            GROUP BY mp.fixture_id
        ),
        ledger_totals AS (
            SELECT
                l.source_id::int       AS fixture_id,
                SUM(l.points_awarded)::int AS ledger_sum
            FROM user_points_ledger l
            WHERE l.source_type = 'match'
              AND l.tournament_id = :tid
              AND l.source_id ~ '^[0-9]+$'
            GROUP BY l.source_id
        )
        SELECT
            f.id                                    AS fixture_id,
            f.home_team || ' vs ' || f.away_team    AS fixture,
            f.stage::text                           AS stage,
            COALESCE(pt.pred_sum, 0)                AS prediction_table_pts,
            COALESCE(lt.ledger_sum, 0)              AS ledger_pts,
            (COALESCE(pt.pred_sum, 0) - COALESCE(lt.ledger_sum, 0))::int AS delta
        FROM fixtures f
        LEFT JOIN pred_totals   pt ON pt.fixture_id = f.id
        LEFT JOIN ledger_totals lt ON lt.fixture_id = f.id
        WHERE f.tournament_id = :tid
          AND f.status = 'completed'
          AND COALESCE(pt.pred_sum, 0) <> COALESCE(lt.ledger_sum, 0)
        ORDER BY ABS(COALESCE(pt.pred_sum, 0) - COALESCE(lt.ledger_sum, 0)) DESC
    """), {"tid": tournament_id})

    fixture_ledger_mismatch = [
        FixtureLedgerMismatch(**dict(row._mapping)) for row in ledger_mismatch_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 6. Per-user breakdown
    # -----------------------------------------------------------------------
    breakdown_rows = await db.execute(text("""
        SELECT
            u.id                                                                            AS user_id,
            u.display_name,
            u.total_points                                                                  AS stored_total,
            COALESCE(SUM(l.points_awarded) FILTER (WHERE l.source_type = 'match'),         0)::int AS match_pts,
            COALESCE(SUM(l.points_awarded) FILTER (WHERE l.source_type = 'group_bracket'), 0)::int AS group_bracket_pts,
            COALESCE(SUM(l.points_awarded) FILTER (WHERE l.source_type = 'ko_bracket'),    0)::int AS ko_bracket_pts,
            COALESCE(SUM(l.points_awarded), 0)::int                                                AS ledger_total
        FROM users u
        LEFT JOIN user_points_ledger l ON l.user_id = u.id AND l.tournament_id = :tid
        WHERE u.is_active = TRUE
        GROUP BY u.id, u.display_name, u.total_points
        ORDER BY u.total_points DESC
    """), {"tid": tournament_id})

    user_breakdown = [
        UserBreakdown(**dict(row._mapping)) for row in breakdown_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 7. KO round grading coverage
    # -----------------------------------------------------------------------
    ko_rows = await db.execute(text("""
        SELECT
            f.stage::text                          AS stage,
            f.tournament_id,
            COUNT(DISTINCT f.id)::int              AS completed_fixtures,
            COUNT(DISTINCT bp.user_id)::int        AS users_with_bracket,
            COUNT(DISTINCT l.user_id)::int         AS users_with_ko_ledger_entry
        FROM fixtures f
        JOIN bracket_predictions bp ON bp.tournament_id = f.tournament_id
        LEFT JOIN user_points_ledger l
               ON l.user_id     = bp.user_id
              AND l.source_type  = 'ko_bracket'
              AND l.source_id    LIKE f.stage::text || ':%'
        WHERE f.tournament_id = :tid
          AND f.status = 'completed'
          AND f.stage::text NOT IN ('group')
        GROUP BY f.stage, f.tournament_id
        ORDER BY f.tournament_id, f.stage
    """), {"tid": tournament_id})

    # Use the Redis guard as the source of truth for "graded" — like groups,
    # a KO stage where every pick scored 0 has no ledger rows but was graded.
    from core.redis_client import redis_client
    ko_coverage: list[KoCoverage] = []
    for row in ko_rows.all():
        row_data = dict(row._mapping)
        guard_key = f"grading:ko:{row_data['tournament_id']}:{row_data['stage']}:graded"
        is_graded = bool(await redis_client.get(guard_key))
        ko_coverage.append(KoCoverage(**row_data, bracket_graded=is_graded))

    # -----------------------------------------------------------------------
    # 8. Group bracket grading coverage
    # -----------------------------------------------------------------------
    # "Graded" = the Redis idempotency guard is set. We can't infer it from
    # ledger presence because grading skips inserting ledger rows when a user
    # scores 0 — a group where every pick scored 0 has no rows but was graded.
    group_rows = await db.execute(text("""
        SELECT
            f.tournament_id,
            f.group_code,
            COUNT(*)::int                                              AS total_fixtures,
            COUNT(*) FILTER (WHERE f.status = 'completed')::int       AS completed
        FROM fixtures f
        WHERE f.tournament_id = :tid
          AND f.stage = 'group'
          AND f.group_code IS NOT NULL
        GROUP BY f.tournament_id, f.group_code
        HAVING COUNT(*) FILTER (WHERE f.status = 'completed') = COUNT(*)
        ORDER BY f.tournament_id, f.group_code
    """), {"tid": tournament_id})

    group_coverage: list[GroupCoverage] = []
    for row in group_rows.all():
        row_data = dict(row._mapping)
        guard_key = f"grading:group:{row_data['group_code']}:graded"
        is_graded = bool(await redis_client.get(guard_key))
        group_coverage.append(GroupCoverage(**row_data, bracket_graded=is_graded))

    # -----------------------------------------------------------------------
    # 9. Completed fixtures with NULL scores
    # -----------------------------------------------------------------------
    null_score_rows = await db.execute(text("""
        SELECT
            id                                  AS fixture_id,
            home_team || ' vs ' || away_team    AS fixture,
            stage::text                         AS stage,
            status::text                        AS status
        FROM fixtures
        WHERE tournament_id = :tid
          AND status = 'completed'
          AND (home_score IS NULL OR away_score IS NULL)
        ORDER BY stage, id
    """), {"tid": tournament_id})

    null_score_completed = [
        NullScoreFixture(**dict(row._mapping)) for row in null_score_rows.all()
    ]

    # -----------------------------------------------------------------------
    # 10. Summary
    # -----------------------------------------------------------------------
    summary_row = await db.execute(text("""
        SELECT
            (SELECT COUNT(*)::int FROM fixtures
             WHERE tournament_id = :tid AND status = 'completed')                       AS completed_fixtures,
            (SELECT COUNT(*)::int FROM match_predictions mp
             JOIN fixtures f ON f.id = mp.fixture_id
             WHERE f.tournament_id = :tid AND mp.is_locked = TRUE)                      AS graded_predictions,
            (SELECT COUNT(*)::int FROM match_predictions mp
             JOIN fixtures f ON f.id = mp.fixture_id
             WHERE f.tournament_id = :tid
               AND f.status = 'completed'
               AND mp.is_locked = FALSE)                                                AS ungraded_predictions_on_completed,
            (SELECT COUNT(*)::int FROM user_points_ledger
             WHERE tournament_id = :tid AND source_type = 'match')                     AS match_ledger_rows,
            (SELECT COUNT(*)::int FROM user_points_ledger
             WHERE tournament_id = :tid AND source_type = 'group_bracket')             AS group_bracket_ledger_rows,
            (SELECT COUNT(*)::int FROM user_points_ledger
             WHERE tournament_id = :tid AND source_type = 'ko_bracket')                AS ko_bracket_ledger_rows,
            (SELECT COUNT(*)::int FROM users WHERE is_active = TRUE)                   AS active_users,
            (SELECT COALESCE(SUM(total_points), 0)::int FROM users
             WHERE is_active = TRUE)                                                    AS total_pts_across_all_users
    """), {"tid": tournament_id})

    summary_data = dict(summary_row.one()._mapping)
    summary = AuditSummary(**summary_data)

    return AuditReport(
        tournament_id=tournament_id,
        summary=summary,
        score_mismatches=score_mismatches,
        grading_orphans=grading_orphans,
        total_points_drift=total_points_drift,
        double_grading=double_grading,
        fixture_ledger_mismatch=fixture_ledger_mismatch,
        user_breakdown=user_breakdown,
        ko_coverage=ko_coverage,
        group_coverage=group_coverage,
        null_score_completed=null_score_completed,
    )


# ---------------------------------------------------------------------------
# Regrade endpoints
# ---------------------------------------------------------------------------

@router.post("/audit/regrade/group/{group_code}")
async def regrade_group(
    group_code: str,
    tournament_id: int = Query(default=1),
    _: User = Depends(get_current_admin),
):
    """Delete the Redis idempotency guard and re-run group bracket grading."""
    from core.redis_client import redis_client
    from workers.bracket_engine import _resolve_group_standings

    guard_key = f"grading:group:{group_code.upper()}:graded"
    await redis_client.delete(guard_key)
    await _resolve_group_standings(group_code.upper())
    return {"ok": True, "group_code": group_code.upper()}


@router.post("/audit/regrade/ko")
async def regrade_ko_stage(
    tournament_id: int = Query(default=1),
    stage: str = Query(...),
    _: User = Depends(get_current_admin),
):
    """Delete the Redis idempotency guard and re-run KO bracket grading for a stage."""
    from core.redis_client import redis_client
    from workers.bracket_engine import _resolve_ko_stage

    guard_key = f"grading:ko:{tournament_id}:{stage}:graded"
    deleted = await redis_client.delete(guard_key)
    if deleted == 0:
        # Key didn't exist — guard wasn't set, so grading may not have run at all.
        # Proceed anyway.
        pass
    await _resolve_ko_stage(tournament_id, stage)
    return {"ok": True, "tournament_id": tournament_id, "stage": stage}
