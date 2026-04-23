"""Suite read routes + SP3.4 extensions (tree, resolve).

Write endpoints (create/update/delete) are omitted by design — writes flow
through the SP3.2 proposal path (POST /proposals with kind='suite').

SP3.4 additions (Task 9):
- GET /{project_slug}/suites/tree              — flat node list for client tree-build
- GET /{project_slug}/suites/{wombat_id}/resolve — returns ResolvedSuite
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()
KIND = "suite"


def _row_out(r) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "wombat_id": r.wombat_id,
        "title": r.title,
        "tags": r.tags,
        "body": r.body,
        "source": {"repo": r.source_repo, "path": r.source_path, "revision": r.source_revision},
        "synced_at": r.synced_at.isoformat(),
    }


@router.get("/{project_slug}/suites")
async def list_suites(
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
        project_id=project.id,
        kind=KIND,
        tags=tag or None,
        q_text=q,
        limit=limit,
        offset=offset,
    )
    return {
        "data": [_row_out(r) for r in rows],
        "pagination": {"total": total, "limit": limit, "offset": offset, "has_more": offset + len(rows) < total},
    }


# NOTE: The /tree and /{wombat_id}/resolve routes must be registered BEFORE
# /{wombat_id} to prevent FastAPI from treating the literal string "tree" as a
# wombat_id path parameter.


@router.get("/{project_slug}/suites/tree")
async def list_suite_tree(
    project_slug: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Return all suite rows as a flat node list.

    Each node exposes exactly three fields:
    - ``wombat_id`` — the suite's unique ID
    - ``title``     — display name
    - ``parent_wombat_id`` — parent's wombat_id, or null for root suites

    Clients build the tree structure client-side from this flat representation.
    No pagination: suite hierarchies are bounded (depth ≤ 20, breadth ≤ project
    content count) and the flat list is cheap to fetch.

    Permissions: viewer or higher.
    """
    q = select(Content).where(
        and_(
            Content.project_id == project.id,
            Content.kind == KIND,
            Content.deleted_at.is_(None),
        )
    )
    rows = list((await session.execute(q)).scalars())

    nodes = []
    for row in rows:
        body = row.body or {}
        parent_wombat_id = body.get("parent_wombat_id") or None
        nodes.append(
            {
                "wombat_id": row.wombat_id,
                "title": row.title,
                "parent_wombat_id": parent_wombat_id,
            }
        )

    return {"nodes": nodes}


@router.get("/{project_slug}/suites/{wombat_id}/resolve")
async def resolve_suite(
    project_slug: str,
    wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Return the ResolvedSuite for a suite root (including its full subtree).

    Uses ResolveService.resolve_suite which performs a recursive BFS over the
    suite hierarchy.  Returns cases contributed by the root suite and all
    descendant suites.

    Permissions: viewer or higher (content read is authenticated + project-scoped).
    """
    repo = Repository(session)

    # Verify the root suite exists in this project before resolving.
    root = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if root is None:
        raise HTTPException(404, detail={"code": "suite_not_found", "message": "Suite not found"})

    from wombat_api.planning.service import ResolveService

    svc = ResolveService(repo)
    resolved = await svc.resolve_suite(project.id, wombat_id)
    return {"data": resolved.model_dump()}


@router.get("/{project_slug}/suites/{wombat_id}")
async def get_suite(
    project_slug: str,
    wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    row = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if row is None:
        raise HTTPException(404, "Suite not found")
    return {"data": _row_out(row)}
