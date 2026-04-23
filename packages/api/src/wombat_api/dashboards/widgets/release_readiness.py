"""Widget: release_readiness — Plan-scoped release execution and pass rates.

For a given plan, resolves the plan's case set (most-recent published revision)
then joins the latest result for each case across all runs that were launched
from that plan (``runs.plan_id = <plan row id>``).

Response shape
--------------
::

    {
        "plan_id":      "<plan wombat_id>",
        "plan_title":   "Release 2026.05 — Payments regression",
        "executed_pct": 0.78,   # float 0.0–1.0
        "pass_pct":     0.91,   # float 0.0–1.0; 0.0 if no executed cases
        "by_status": {
            "pass":    14,
            "fail":     3,
            "blocked":  1,
            "skipped":  1,
            "not_run":  9,
        },
        "blockers": [           # bounded to 25; ordered alphabetically by wombat_id
            {"wombat_id": "TC-001", "title": "…", "status": "fail"},
            …
        ]
    }

``scope_kinds`` includes both ``"project"`` and ``"plan"``:

* On **plan** scope  → ``scope["plan_wombat_id"]`` provides the plan ID directly.
* On **project** scope → ``filters["plan_id"]`` (a plan wombat_id) is **required**.
  The route dispatcher (Task 17) enforces this via ``META["requires"] = ["plan_id"]``,
  which it treats as "plan_id must be present in filters when scope is project".
  The widget itself raises ``HTTPException(400, …)`` as a belt-and-suspenders guard
  so direct calls to ``_query`` also fail correctly.

Resolution strategy
-------------------
We lazy-import ``ResolveService`` from ``wombat_api.planning.service`` (Task 7,
running in a parallel wave).  If that module is not yet present (CI race), we
fall back to a direct SQL approach that fetches the plan body and expands only
the ``explicit_cases.add`` list and the ``cases`` arrays from referenced suites,
skipping tag-filter expansion.  The fallback is documented in the code so it is
obvious if it ever triggers in production.

Blocker ordering: alphabetical by ``wombat_id`` (deterministic; worst-case is
that blockers starting with "TC-AAA…" appear first, which is acceptable for MVP).
Bounded to 25 entries.

Registered at import time via side-effect: ``REGISTRY.register(META, _query)``.
"""

from __future__ import annotations

import logging
import uuid

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetMeta, WidgetScope

logger = logging.getLogger(__name__)

META: WidgetMeta = {
    "slug": "release_readiness",
    "title": "Release readiness",
    # On project scope the route enforces that filters.plan_id is present
    # by reading META["requires"].  The route treats any key in "requires"
    # as a required filter parameter when scope == "project".  On plan scope
    # the plan_wombat_id is already embedded in the scope object so no extra
    # filter is needed.
    "scope_kinds": {"project", "plan"},
    "requires": ["plan_id"],
}

_BLOCKER_LIMIT = 25


async def _query(scope: WidgetScope, filters: WidgetFilters, session: AsyncSession) -> dict:
    """Compute release-readiness metrics for a plan.

    Parameters
    ----------
    scope:
        ``kind`` is ``"plan"`` or ``"project"``.
        On ``kind="plan"``, ``scope["plan_wombat_id"]`` is used.
        On ``kind="project"``, ``filters["plan_id"]`` must be set (a plan wombat_id).
    filters:
        ``plan_id`` — required when scope is ``"project"``.
    session:
        Async SQLAlchemy session.
    """
    project_id_str: str = scope["project_id"]
    try:
        project_id = uuid.UUID(project_id_str)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid project_id") from exc

    # ------------------------------------------------------------------ #
    # 1. Determine plan wombat_id                                          #
    # ------------------------------------------------------------------ #
    if scope.get("kind") == "plan" and scope.get("plan_wombat_id"):
        plan_wid = scope["plan_wombat_id"]
    else:
        plan_wid = (filters or {}).get("plan_id")  # type: ignore[assignment]

    if not plan_wid:
        raise HTTPException(
            status_code=400,
            detail="widget release_readiness requires plan_id (set filters.plan_id or use plan scope)",
        )

    # ------------------------------------------------------------------ #
    # 2. Load the plan content row (most recent revision)                 #
    # ------------------------------------------------------------------ #
    plan_row_sql = sa.text(
        """
        SELECT id, wombat_id, title, body
          FROM content
         WHERE project_id = :pid
           AND kind       = 'plan'
           AND wombat_id  = :wid
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
        """
    )
    plan_result = await session.execute(plan_row_sql, {"pid": project_id, "wid": plan_wid})
    plan_row = plan_result.first()
    if plan_row is None:
        # Plan doesn't exist yet — return zeroed out response rather than 404
        # so the widget can render an "empty" state without a route error.
        return _empty_response(plan_wid, "Unknown plan")

    plan_db_id: uuid.UUID = plan_row.id
    plan_title: str = plan_row.title or plan_wid

    # ------------------------------------------------------------------ #
    # 3. Resolve the plan → case set (wombat_ids + titles)               #
    # ------------------------------------------------------------------ #
    plan_body: dict = plan_row.body or {}
    case_map: dict[str, str] = await _resolve_plan_cases(
        project_id, plan_body, plan_db_id, session
    )
    # case_map: {wombat_id -> title}

    total_cases = len(case_map)
    if total_cases == 0:
        return _empty_response(plan_wid, plan_title)

    # ------------------------------------------------------------------ #
    # 4. Find the latest result for each case across runs of this plan    #
    # ------------------------------------------------------------------ #
    # Strategy:
    #   - Join: results → run_cases → run_case_snapshots (for wombat_id)
    #   - Filter: results.run_id IN (SELECT id FROM runs WHERE plan_id = :plan_db_id)
    #   - For each snapshot_wombat_id, take the result with the latest updated_at.
    #
    # We return (snapshot_wombat_id, status) for the latest result per case.
    latest_results_sql = sa.text(
        """
        WITH ranked AS (
            SELECT
                rcs.snapshot_wombat_id,
                res.status,
                ROW_NUMBER() OVER (
                    PARTITION BY rcs.snapshot_wombat_id
                    ORDER BY res.updated_at DESC
                ) AS rn
              FROM results      res
              JOIN run_cases    rc   ON rc.id     = res.run_case_id
              JOIN run_case_snapshots rcs ON rcs.id = rc.snapshot_id
             WHERE res.run_id IN (
                     SELECT id FROM runs
                      WHERE plan_id   = :plan_db_id
                 )
        )
        SELECT snapshot_wombat_id, status
          FROM ranked
         WHERE rn = 1
        """
    )
    latest_result = await session.execute(latest_results_sql, {"plan_db_id": plan_db_id})
    latest_by_wid: dict[str, str] = {
        row.snapshot_wombat_id: row.status for row in latest_result
    }

    # ------------------------------------------------------------------ #
    # 5. Compute metrics                                                  #
    # ------------------------------------------------------------------ #
    by_status: dict[str, int] = {"pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_run": 0}

    for wid in case_map:
        status = latest_by_wid.get(wid)
        if status is None:
            by_status["not_run"] += 1
        elif status in by_status:
            by_status[status] += 1
        else:
            # Unknown status value; count it as not_run so metrics stay consistent.
            logger.warning("release_readiness: unknown result status %r for case %s", status, wid)
            by_status["not_run"] += 1

    cases_with_result = total_cases - by_status["not_run"]
    executed_pct = cases_with_result / total_cases if total_cases else 0.0
    pass_pct = by_status["pass"] / cases_with_result if cases_with_result else 0.0

    # ------------------------------------------------------------------ #
    # 6. Collect blockers (fail | blocked), bounded to 25, alpha order   #
    # ------------------------------------------------------------------ #
    blockers: list[dict] = []
    for wid in sorted(case_map.keys()):
        status = latest_by_wid.get(wid)
        if status in ("fail", "blocked"):
            blockers.append(
                {
                    "wombat_id": wid,
                    "title": case_map[wid],
                    "status": status,
                }
            )
        if len(blockers) >= _BLOCKER_LIMIT:
            break

    return {
        "plan_id": plan_wid,
        "plan_title": plan_title,
        "executed_pct": round(executed_pct, 6),
        "pass_pct": round(pass_pct, 6),
        "by_status": by_status,
        "blockers": blockers,
    }


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


async def _resolve_plan_cases(
    project_id: uuid.UUID,
    plan_body: dict,
    plan_db_id: uuid.UUID,
    session: AsyncSession,
) -> dict[str, str]:
    """Return a ``{wombat_id: title}`` map for the plan's resolved case set.

    Preferred path: lazy-import ``ResolveService`` from ``wombat_api.planning.service``
    (Task 7).  If that module is not yet importable (CI ordering race), we fall back
    to the inline SQL approach that handles ``explicit_cases.add`` and referenced
    suite ``cases`` arrays, but skips tag-filter expansion (logged as a warning).
    """
    try:
        from wombat_api.database.repository import Repository  # noqa: PLC0415
        from wombat_api.planning.service import ResolveService  # noqa: PLC0415 (lazy import)

        repo = Repository(session)
        svc = ResolveService(repo)
        resolved = await svc.resolve_plan(project_id, plan_body)
        return {c.wombat_id: c.title for c in resolved.cases}
    except ImportError:
        logger.warning(
            "release_readiness: ResolveService not available, falling back to inline SQL resolution"
        )
        return await _resolve_plan_cases_inline(project_id, plan_body, session)


async def _resolve_plan_cases_inline(
    project_id: uuid.UUID,
    plan_body: dict,
    session: AsyncSession,
) -> dict[str, str]:
    """Fallback resolution: explicit_cases.add + suite refs (cases arrays only).

    Does NOT expand tag/priority filters from plan.include — those require the
    full ResolveService.  This path is used only when ResolveService is not yet
    importable (parallel wave CI race).

    In production, ResolveService is always present; this fallback exists to make
    the widget self-contained so it can be committed before Task 7 lands.
    """
    explicit_cases = plan_body.get("explicit_cases") or {}
    if isinstance(explicit_cases, list):
        add_ids: list[str] = explicit_cases
        remove_ids: set[str] = set()
    else:
        add_ids = list(explicit_cases.get("add") or [])
        remove_ids = set(explicit_cases.get("remove") or [])

    suite_refs: list[str] = list(plan_body.get("suite_refs") or [])

    # Collect IDs from suite refs (cases arrays only, not filter-expanded).
    suite_case_ids: set[str] = set()
    if suite_refs:
        suite_sql = sa.text(
            """
            SELECT body
              FROM content
             WHERE project_id = :pid
               AND kind       = 'suite'
               AND wombat_id  = ANY(:refs)
               AND deleted_at IS NULL
            """
        )
        suite_rows = await session.execute(suite_sql, {"pid": project_id, "refs": suite_refs})
        for row in suite_rows:
            body = row.body or {}
            suite_case_ids.update(body.get("cases") or [])

    all_ids = (set(add_ids) | suite_case_ids) - remove_ids

    if not all_ids:
        return {}

    # Fetch titles for all IDs.
    rows_sql = sa.text(
        """
        SELECT wombat_id, title
          FROM content
         WHERE project_id = :pid
           AND kind       = 'testcase'
           AND wombat_id  = ANY(:ids)
           AND deleted_at IS NULL
        """
    )
    rows = await session.execute(rows_sql, {"pid": project_id, "ids": list(all_ids)})
    return {row.wombat_id: row.title for row in rows}


def _empty_response(plan_wid: str, plan_title: str) -> dict:
    """Return a zero-valued response (no cases or runs yet)."""
    return {
        "plan_id": plan_wid,
        "plan_title": plan_title,
        "executed_pct": 0.0,
        "pass_pct": 0.0,
        "by_status": {"pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_run": 0},
        "blockers": [],
    }


REGISTRY.register(META, _query)
