"""Widget: passfail_trend — Pass / fail trend grouped by day.

Groups result counts (pass/fail/blocked/skipped) by calendar day.

Real column names (confirmed from SP3.3 schema):
- ``results.updated_at``  — when the result row was last recorded; used as the
  date-bucketing column.  (The spec draft called this ``finished_at`` but the
  actual column is ``updated_at``.)
- ``runs.closed_at``      — used for the time-window filter.  NULL means the
  run is still open; results from open runs are still included in the counts
  (we filter on updated_at, not closed_at, so in-progress runs contribute).
- ``runs.plan_id``        — UUID FK into ``content.id``; nullable.
- ``runs.environment_id`` — UUID FK into ``environments.id``; nullable.

Registered at import time via side-effect: ``REGISTRY.register(META, _query)``.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetMeta, WidgetScope

META: WidgetMeta = {
    "slug": "passfail_trend",
    "title": "Pass / fail trend",
    "scope_kinds": {"project", "plan"},
    "requires": [],
}

_WINDOW_DAYS: dict[str, int | None] = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "all": None,
}


async def _query(scope: WidgetScope, filters: WidgetFilters, session: AsyncSession) -> dict:
    """Return pass/fail/blocked/skipped counts bucketed by calendar day.

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
    window_key = (filters.get("window") or "30d") if filters else "30d"
    days = _WINDOW_DAYS.get(window_key, 30)

    where_clauses: list[str] = ["r.project_id = :pid"]
    params: dict[str, object] = {"pid": scope["project_id"]}

    # Time window: filter on results.updated_at so in-flight runs still
    # contribute their recorded results.
    if days is not None:
        where_clauses.append("res.updated_at >= now() - make_interval(days => :days)")
        params["days"] = days

    # Optional environment filter.
    if filters and (env_id := filters.get("env_id")):
        where_clauses.append("r.environment_id = :env_id")
        params["env_id"] = env_id

    # Plan restriction — either from plan scope or from project-scope filter.
    if scope.get("kind") == "plan" and scope.get("plan_wombat_id"):
        where_clauses.append(
            "r.plan_id = ("
            "SELECT id FROM content"
            " WHERE wombat_id = :plan_wid"
            " AND project_id = :pid"
            " AND kind = 'plan'"
            " LIMIT 1"
            ")"
        )
        params["plan_wid"] = scope["plan_wombat_id"]
    elif filters and (plan_filter := filters.get("plan_id")):
        where_clauses.append(
            "r.plan_id = ("
            "SELECT id FROM content"
            " WHERE wombat_id = :plan_wid"
            " AND project_id = :pid"
            " AND kind = 'plan'"
            " LIMIT 1"
            ")"
        )
        params["plan_wid"] = plan_filter

    where_sql = " AND ".join(where_clauses)

    # NOTE: 'pass' is a Python keyword; use safe column aliases (pass_count etc.)
    # in SQL and map back to the JSON field names in Python.
    sql = f"""
        SELECT
            date_trunc('day', res.updated_at)                         AS day,
            sum(CASE WHEN res.status = 'pass'    THEN 1 ELSE 0 END)  AS pass_count,
            sum(CASE WHEN res.status = 'fail'    THEN 1 ELSE 0 END)  AS fail_count,
            sum(CASE WHEN res.status = 'blocked' THEN 1 ELSE 0 END)  AS blocked_count,
            sum(CASE WHEN res.status = 'skipped' THEN 1 ELSE 0 END)  AS skipped_count
          FROM results res
          JOIN runs r ON r.id = res.run_id
         WHERE {where_sql}
         GROUP BY 1
         ORDER BY 1
    """

    rows = (await session.execute(sa.text(sql), params)).all()

    points = [
        {
            "date": row.day.date().isoformat() if row.day is not None else None,
            "pass": int(row.pass_count),
            "fail": int(row.fail_count),
            "blocked": int(row.blocked_count),
            "skipped": int(row.skipped_count),
        }
        for row in rows
    ]
    return {"points": points}


REGISTRY.register(META, _query)
