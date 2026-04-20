"""Shared step read routes.

MVP decision: write endpoints (POST/PUT/DELETE) are intentionally omitted.
Authored content is mutated only via Git + `wombat sync`.  See deferred item
#8 (API-first writes) in the deferred features list.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()
KIND = "shared_step"


def _row_out(r) -> dict:
    return {
        "id": str(r.id), "kind": r.kind, "wombat_id": r.wombat_id,
        "title": r.title, "tags": r.tags, "body": r.body,
        "source": {"repo": r.source_repo, "path": r.source_path,
                   "revision": r.source_revision},
        "synced_at": r.synced_at.isoformat(),
    }


@router.get("/{project_slug}/shared-steps")
async def list_shared_steps(
    project_slug: str,
    tag: list[str] | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    rows, total = await repo.list_content(
        project_id=project.id, kind=KIND, tags=tag or None,
        q_text=q, limit=limit, offset=offset,
    )
    return {
        "data": [_row_out(r) for r in rows],
        "pagination": {"total": total, "limit": limit,
                       "offset": offset, "has_more": offset + len(rows) < total},
    }


@router.get("/{project_slug}/shared-steps/{wombat_id}")
async def get_shared_step(
    project_slug: str, wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    row = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if row is None:
        raise HTTPException(404, "Shared step not found")
    return {"data": _row_out(row)}
