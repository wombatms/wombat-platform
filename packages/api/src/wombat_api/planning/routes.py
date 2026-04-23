"""Planning routes.

This module provides:
- POST  /{project_slug}/content/resolve   (Task 10: draft preview, read-only)

Additional endpoints (Tasks 8, 9) will be added by parallel agents:
- POST  /{project_slug}/plans/{wombat_id}/clone
- GET   /{project_slug}/plans/{wombat_id}/resolve
- POST  /{project_slug}/plans/{wombat_id}/start-run
- GET   /{project_slug}/suites/tree
- GET   /{project_slug}/suites/{wombat_id}/resolve
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.planning.schemas import (
    DraftResolveRequest,
    ResolvedCase,
    ResolvedSuite,
)
from wombat_api.planning.service import ResolveService
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()


@router.post("/{project_slug}/content/resolve")
async def resolve_draft(
    project_slug: str,
    payload: DraftResolveRequest,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Draft plan or suite preview endpoint.

    Accepts an unsaved draft body and returns the resolved case set
    **without persisting anything** — no proposal rows, no content rows.

    This is the live-preview transport used by the builder form while the
    user is still editing.  The response shape is identical to the saved-plan
    resolve endpoint (GET /{project_slug}/plans/{wombat_id}/resolve) so the
    frontend can reuse the same response handler.

    Behaviour by ``kind``:
    - ``"plan"`` — delegates to ``ResolveService.resolve_plan``, which runs the
      full filter / suite-ref / explicit-cases composition pipeline.
    - ``"suite"`` — synthesises a suite in memory from the draft's ``cases``
      list + ``include`` filter, resolves titles and returns a ``ResolvedSuite``.
      If the draft body has ``parent_wombat_id``, the draft resolution does NOT
      recurse into the unsaved parent chain; drafts stand alone.  This is by
      design: the parent doesn't exist in the DB yet, so there's nothing to
      walk.
    - anything else → 422.

    Auth: any project viewer may call this endpoint (read-only; same auth as
    ``GET /{project_slug}/plans``).
    """
    repo = Repository(session)
    svc = ResolveService(repo)

    if payload.kind == "plan":
        return await svc.resolve_plan(project.id, payload.body)

    if payload.kind == "suite":
        # Synthesise a suite in memory from the draft body.
        # We combine explicit cases listed under "cases" with anything
        # matched by the "include" filter.  parent_wombat_id is intentionally
        # NOT followed: the parent may not exist in the DB yet for an unsaved
        # draft, and the spec says drafts stand alone.
        explicit_case_ids: set[str] = set(payload.body.get("cases") or [])
        filter_ids: set[str] = await svc._match_filter(  # noqa: SLF001
            project.id,
            payload.body.get("include") or {},
        )
        all_ids: set[str] = explicit_case_ids | filter_ids

        if all_ids:
            rows = await repo.get_content_by_wombat_ids(project.id, list(all_ids))
        else:
            rows = []

        def _source(wid: str) -> str:
            # Preserve the filter/explicit distinction in source labels.
            if wid in filter_ids:
                return "filter"
            return "explicit_add"

        from wombat_api.planning.service import _extract_title

        cases = sorted(
            (
                ResolvedCase(
                    wombat_id=r.wombat_id,
                    title=_extract_title(r),
                    source=_source(r.wombat_id),
                )
                for r in rows
                if r.wombat_id
            ),
            key=lambda c: c.wombat_id,
        )
        return ResolvedSuite(cases=cases, count=len(cases), warnings=[])

    raise HTTPException(
        status_code=422,
        detail={
            "code": "invalid_kind",
            "message": "kind must be 'plan' or 'suite'",
            "field": "kind",
            "hint": "Accepted values: 'plan', 'suite'",
        },
    )
