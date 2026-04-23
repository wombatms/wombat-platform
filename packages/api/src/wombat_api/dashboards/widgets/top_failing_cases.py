"""Dashboard widget: top_failing_cases.

Returns the top-10 test cases ranked by failure count within a configurable
time window, joined with snapshot metadata for display titles.

Real column names (SP3.3 schema, confirmed from models.py):
- ``results.status``       — 'pass' | 'fail' | 'blocked' | 'skipped'
- ``results.updated_at``   — completion timestamp (spec draft called it
                             ``finished_at``; the actual column is ``updated_at``)
- ``results.run_case_id``  — FK → ``run_cases.id``
- ``run_cases.snapshot_id``         — FK → ``run_case_snapshots.id``
- ``run_case_snapshots.snapshot_wombat_id`` — the case wombat_id at snapshot time
- ``run_case_snapshots.snapshot_title``     — the case title at snapshot time

Join path::

    results
        JOIN run_cases rc ON rc.id = results.run_case_id
        JOIN run_case_snapshots rcs ON rcs.id = rc.snapshot_id
        JOIN runs r ON r.id = results.run_id

Project isolation is enforced via ``runs.project_id = :project_id``.

Ordering tiebreak: ``last_failed_at DESC, snapshot_wombat_id ASC`` (deterministic).

Registered at import time via side-effect: ``REGISTRY.register(META, _query)``.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetMeta, WidgetScope

log = logging.getLogger(__name__)

META: WidgetMeta = {
    "slug": "top_failing_cases",
    "title": "Top failing cases",
    "scope_kinds": {"project", "plan"},
    "requires": [],
}

_WINDOW_INTERVALS: dict[str, str | None] = {
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    "all": None,
}


async def _query(scope: WidgetScope, filters: WidgetFilters, session: AsyncSession) -> dict[str, Any]:
    """Return ``{"cases": [...]}`` for the top_failing_cases widget.

    Parameters
    ----------
    scope:
        ``kind`` is ``"project"`` or ``"plan"``.  For plan scope,
        ``plan_wombat_id`` is set and we restrict to that plan's runs.
    filters:
        ``window``  — ``"7d" | "30d" | "90d" | "all"`` (default ``"30d"``).
        ``env_id``  — restrict to one environment UUID.
        ``plan_id`` — restrict by plan's ``wombat_id`` when scope is ``"project"``.
    """
    project_id = scope["project_id"]
    plan_wid = scope.get("plan_wombat_id")

    window_key: str = (filters.get("window") or "30d") if filters else "30d"
    if window_key not in _WINDOW_INTERVALS:
        window_key = "30d"
    interval = _WINDOW_INTERVALS[window_key]

    env_id: str | None = filters.get("env_id") if filters else None
    filter_plan_id: str | None = filters.get("plan_id") if filters else None

    # Build WHERE clauses and params progressively.
    where: list[str] = [
        "r.project_id = :project_id",
        "res.status = 'fail'",
    ]
    params: dict[str, Any] = {"project_id": project_id}

    # Time window filter on results.updated_at (the actual completion timestamp).
    if interval is not None:
        where.append(f"res.updated_at >= now() - INTERVAL '{interval}'")

    # Optional environment filter.
    # Use CAST() instead of ::uuid — asyncpg/psycopg2 handle named params with
    # colons, so the PostgreSQL :: cast suffix causes a syntax error.
    if env_id:
        where.append("r.environment_id = CAST(:env_id AS uuid)")
        params["env_id"] = env_id

    # Plan filter: plan scope (plan_wid) takes priority, then filters.plan_id.
    if plan_wid:
        where.append(
            "r.plan_id = ("
            "  SELECT id FROM content"
            "  WHERE wombat_id = :plan_wid"
            "    AND project_id = :project_id"
            "    AND kind = 'plan'"
            "  LIMIT 1"
            ")"
        )
        params["plan_wid"] = plan_wid
    elif filter_plan_id:
        where.append(
            "r.plan_id = ("
            "  SELECT id FROM content"
            "  WHERE wombat_id = :filter_plan_wid"
            "    AND project_id = :project_id"
            "    AND kind = 'plan'"
            "  LIMIT 1"
            ")"
        )
        params["filter_plan_wid"] = filter_plan_id

    where_sql = " AND ".join(where)

    # Group by snapshot wombat_id + title (both come from run_case_snapshots),
    # count failures and track the latest failure timestamp.
    # Tiebreak order: failures DESC, last_failed_at DESC, wombat_id ASC (deterministic).
    sql = text(
        f"""
        SELECT
            rcs.snapshot_wombat_id                          AS wombat_id,
            rcs.snapshot_title                              AS title,
            COUNT(*)                                        AS failures,
            MAX(res.updated_at)                             AS last_failed_at
        FROM results res
        JOIN run_cases rc   ON rc.id  = res.run_case_id
        JOIN run_case_snapshots rcs ON rcs.id = rc.snapshot_id
        JOIN runs r         ON r.id   = res.run_id
        WHERE {where_sql}
        GROUP BY rcs.snapshot_wombat_id, rcs.snapshot_title
        ORDER BY failures DESC, last_failed_at DESC, wombat_id ASC
        LIMIT 10
        """
    )

    t0 = time.monotonic()
    result = await session.execute(sql, params)
    rows = result.mappings().all()
    duration_ms = int((time.monotonic() - t0) * 1000)

    log.info(
        "widget=top_failing_cases project=%s window=%s env_id=%s rows=%d duration_ms=%d",
        project_id,
        window_key,
        env_id,
        len(rows),
        duration_ms,
    )

    cases = [
        {
            "wombat_id": row["wombat_id"],
            "title": row["title"],
            "failures": int(row["failures"]),
            "last_failed_at": row["last_failed_at"].isoformat() if row["last_failed_at"] is not None else None,
        }
        for row in rows
    ]

    return {"cases": cases}


REGISTRY.register(META, _query)
