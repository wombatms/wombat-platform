"""Dashboard widget: recent_runs.

Returns the last 10 runs for a project (or plan scope), ordered by
``closed_at DESC NULLS LAST``.  For each run the response includes a
``pass_rate`` derived from a LATERAL subquery over the ``results`` table so
that totals are computed in a single round-trip.

Real column names (SP3.3 schema):
- ``runs.closed_at``        — completion timestamp (spec calls it ``finished_at``)
- ``runs.owner_id``         — FK → users.id  (spec calls it ``started_by``)
- ``runs.environment_id``   — FK → environments.id
- ``runs.plan_id``          — nullable UUID (no FK constraint yet; SP3.4 placeholder)

The JSON response uses the spec wire names so the frontend doesn't need adapting:
  ``finished_at`` = closed_at
  ``started_by``  = users.email
  ``environment`` = environments.name
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetMeta, WidgetScope

log = logging.getLogger(__name__)

META: WidgetMeta = {
    "slug": "recent_runs",
    "title": "Recent runs",
    "scope_kinds": {"project", "plan"},
    "requires": [],
}

# ---------------------------------------------------------------------------
# Window → interval mapping
# ---------------------------------------------------------------------------

_WINDOW_INTERVALS: dict[str, str | None] = {
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    "all": None,
}


async def _query(scope: WidgetScope, filters: WidgetFilters, session: AsyncSession) -> dict[str, Any]:
    """Return ``{"runs": [...]}`` for the recent_runs widget."""
    project_id = scope["project_id"]
    plan_wid = scope.get("plan_wombat_id")

    window_key: str = filters.get("window", "30d") or "30d"
    if window_key not in _WINDOW_INTERVALS:
        window_key = "30d"
    interval = _WINDOW_INTERVALS[window_key]

    env_id: str | None = filters.get("env_id")
    filter_plan_id: str | None = filters.get("plan_id")

    # Build WHERE clauses and params progressively.
    where: list[str] = ["r.project_id = :project_id"]
    params: dict[str, Any] = {"project_id": project_id}

    # Time window filter on closed_at.
    if interval is not None:
        where.append(f"(r.closed_at IS NULL OR r.closed_at >= now() - INTERVAL '{interval}')")

    # Environment filter.
    # Pass env_id as a plain string; Postgres will implicitly cast the UUID
    # literal to the uuid column type.  Avoid `:env_id::uuid` because asyncpg
    # translates named params to positional ($N) first and then the `::` syntax
    # immediately after the positional param causes a server-side syntax error.
    if env_id:
        where.append("r.environment_id = :env_id")
        params["env_id"] = env_id

    # Plan filter: two sources — scope=plan (plan_wid) takes priority, then
    # filters.plan_id (wombat_id string from the project-scope filter bar).
    if plan_wid:
        # Scope is "plan": resolve the plan's DB UUID via content table.
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
        # Project-scope filter bar passes wombat_id as plan_id filter.
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

    sql = text(
        f"""
        SELECT
            r.id::text                                         AS id,
            r.title                                            AS title,
            r.status                                           AS status,
            COALESCE(s.pass_count, 0)::float
                / NULLIF(COALESCE(s.total_count, 0), 0)       AS pass_rate,
            e.name                                             AS environment,
            u.email                                            AS started_by,
            r.closed_at                                        AS finished_at
        FROM runs r
        LEFT JOIN environments e ON e.id = r.environment_id
        LEFT JOIN users u        ON u.id = r.owner_id
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE status = 'pass') AS pass_count,
                COUNT(*)                                 AS total_count
            FROM results
            WHERE run_id = r.id
        ) s ON TRUE
        WHERE {where_sql}
        ORDER BY r.closed_at DESC NULLS LAST
        LIMIT 10
        """
    )

    import time

    t0 = time.monotonic()
    result = await session.execute(sql, params)
    rows = result.mappings().all()
    duration_ms = int((time.monotonic() - t0) * 1000)

    log.info(
        "widget=recent_runs project=%s window=%s env_id=%s rows=%d duration_ms=%d",
        project_id,
        window_key,
        env_id,
        len(rows),
        duration_ms,
    )

    runs = [
        {
            "id": row["id"],
            "title": row["title"],
            "status": row["status"],
            "pass_rate": float(row["pass_rate"]) if row["pass_rate"] is not None else None,
            "environment": row["environment"],
            "started_by": row["started_by"],
            "finished_at": row["finished_at"].isoformat() if row["finished_at"] is not None else None,
        }
        for row in rows
    ]

    return {"runs": runs}


# Register at import time so the REGISTRY knows about this widget.
REGISTRY.register(META, _query)
