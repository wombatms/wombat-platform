"""Dashboard routes.

Two endpoints:
  GET /{project_slug}/dashboards/widgets          — list all registered widgets
  GET /{project_slug}/dashboards/widget/{slug}    — dispatch to a registered widget query

Permission: ``runs:read`` is required for both endpoints (all project roles hold it
by default so any project member can view dashboards).

Error codes surfaced as SP2 error envelopes (``{"error": {"code": ..., "message": ...}}``):
  - 404  widget not found
  - 400  scope not supported by widget
  - 400  required filter missing (e.g. ``plan_id`` for ``release_readiness`` on project scope)
"""

from __future__ import annotations

import logging
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

import wombat_api.dashboards  # noqa: F401 — side-effect: registers all 5 widgets
from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetScope
from wombat_api.database.engine import get_session
from wombat_api.rbac.middleware import require_permission
from wombat_api.rbac.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Helper: serialise WidgetMeta for the wire (scope_kinds set → sorted list)
# ---------------------------------------------------------------------------


def _serialise_meta(meta: dict) -> dict:
    """Return a JSON-serialisable copy of a WidgetMeta dict.

    ``scope_kinds`` is a ``set[str]`` internally; convert to a sorted list so
    the response is deterministic across Python versions and dictionary orderings.
    """
    return {
        "slug": meta["slug"],
        "title": meta["title"],
        "scope_kinds": sorted(meta["scope_kinds"]),
        "requires": list(meta["requires"]),
    }


# ---------------------------------------------------------------------------
# GET /{project_slug}/dashboards/widgets  — list all registered widgets
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/dashboards/widgets")
async def list_widgets(
    project_slug: str,
    authctx=Depends(require_permission(Permission.RUNS_READ)),
):
    """Return metadata for all registered dashboard widgets.

    Callers use this to discover which widgets exist, what scopes they support,
    and what filters (if any) are required.

    Response::

        {
            "widgets": [
                {
                    "slug": "passfail_trend",
                    "title": "Pass / fail trend",
                    "scope_kinds": ["plan", "project"],
                    "requires": []
                },
                …
            ]
        }
    """
    # authctx is (project, principal, role) — project already verified by require_permission.
    return {"widgets": [_serialise_meta(m) for m in REGISTRY.list_meta()]}


# ---------------------------------------------------------------------------
# GET /{project_slug}/dashboards/widget/{slug}  — dispatch to widget query
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/dashboards/widget/{slug}")
async def get_widget(
    project_slug: str,
    slug: str,
    scope: Literal["project", "plan"] = Query(..., description="Widget scope kind"),
    scope_id: str = Query(..., description="Project UUID (project scope) or plan wombat_id (plan scope)"),
    window: str = Query("30d", description="Time window: 7d | 30d | 90d | all"),
    env_id: str | None = Query(None, description="Optional environment UUID filter"),
    plan_id: str | None = Query(None, description="Optional plan wombat_id filter (project scope only)"),
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Dispatch a widget query and return its result.

    Validation order:
    1. 404 if slug not registered.
    2. 400 if scope not in ``meta["scope_kinds"]``.
    3. 400 if any key in ``meta["requires"]`` is missing from the effective filters
       when scope is ``"project"`` (on plan scope the plan is already in scope_id).
    4. Build ``WidgetScope`` and ``WidgetFilters``, then call the widget query.
    """
    project, _principal, _role = authctx

    # --- 1. Resolve widget ---
    try:
        meta, query = REGISTRY.get(slug)
    except KeyError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "widget_not_found",
                "message": f"No widget registered with slug '{slug}'.",
                "field": "slug",
                "hint": None,
            },
        ) from exc

    # --- 2. Validate scope ---
    if scope not in meta["scope_kinds"]:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "widget_scope_not_supported",
                "message": f"widget {slug} does not support scope {scope}",
                "field": "scope",
                "hint": f"Supported scopes: {sorted(meta['scope_kinds'])}",
            },
        )

    # --- 3. Validate required filters ---
    # ``meta["requires"]`` lists filter keys that must be present when scope=="project".
    # On plan scope, the plan wombat_id is already conveyed via scope_id, so we only
    # enforce required filters on the project scope.
    if scope == "project" and meta.get("requires"):
        effective_filters = {"window": window, "env_id": env_id, "plan_id": plan_id}
        for required_key in meta["requires"]:
            if not effective_filters.get(required_key):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "widget_missing_filter",
                        "message": (
                            f"widget {slug} requires filter '{required_key}' "
                            f"when scope is 'project'"
                        ),
                        "field": required_key,
                        "hint": f"Pass ?{required_key}=<value> in the query string.",
                    },
                )

    # --- 4. Build scope and filters ---
    widget_scope: WidgetScope = {
        "kind": scope,
        "project_id": str(project.id),
        "plan_wombat_id": scope_id if scope == "plan" else None,
    }

    widget_filters: WidgetFilters = {}
    if window:
        widget_filters["window"] = window  # type: ignore[typeddict-item]
    if env_id:
        widget_filters["env_id"] = env_id
    if plan_id:
        widget_filters["plan_id"] = plan_id

    # --- 5. Invoke the query ---
    t0 = time.monotonic()
    result = await query(widget_scope, widget_filters, session)
    duration_ms = int((time.monotonic() - t0) * 1000)

    logger.info(
        "widget=%s project=%s scope=%s scope_id=%s duration_ms=%d",
        slug,
        project_slug,
        scope,
        scope_id,
        duration_ms,
    )

    return result
