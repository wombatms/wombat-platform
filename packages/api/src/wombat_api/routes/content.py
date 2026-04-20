"""Content routes — unified content access by ID.

Endpoints:
- GET /{slug}/content/{content_id}          — fetch full body by UUID or wombat_id
- GET /{slug}/content/{content_id}/related  — find semantically related content
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()

_WOMBAT_PREFIXES = {"TC", "SS", "PLAN", "STORY", "SUITE"}


def _content_out(r) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "wombat_id": r.wombat_id,
        "title": r.title,
        "tags": r.tags,
        "body": r.body,
        "source": {
            "repo": r.source_repo,
            "path": r.source_path,
            "revision": r.source_revision,
        },
        "synced_at": r.synced_at.isoformat(),
    }


def _is_wombat_id(value: str) -> bool:
    """Return True if *value* looks like a WombatID rather than a UUID."""
    prefix = value.split("-")[0].upper()
    return prefix in _WOMBAT_PREFIXES


# ---------------------------------------------------------------------------
# GET /content/{content_id}
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/content/{content_id}")
async def get_content(
    project_slug: str,
    content_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Fetch full body for a content row by UUID or wombat_id.

    Accepts either:
    - A UUID (e.g. ``3fa85f64-...``)
    - A WombatID string (e.g. ``TC-LOGIN-001``)
    """
    from wombat_api.database.repository import Repository

    repo = Repository(session)

    if _is_wombat_id(content_id):
        # Resolve wombat_id — kind is unknown so search across all kinds.
        from sqlalchemy import and_, select

        from wombat_api.database.models import Content

        q = select(Content).where(
            and_(
                Content.project_id == project.id,
                Content.wombat_id == content_id,
                Content.deleted_at.is_(None),
            )
        )
        row = (await session.execute(q)).scalar_one_or_none()
    else:
        try:
            uid = uuid.UUID(content_id)
        except ValueError as exc:
            raise HTTPException(422, f"Invalid content_id: must be a UUID or WombatID, got {content_id!r}") from exc
        row = await repo.get_content_by_id(uid)
        if row is not None and row.project_id != project.id:
            row = None  # security: hide content from other projects

    if row is None:
        raise HTTPException(404, "Content not found")
    return {"data": _content_out(row)}


# ---------------------------------------------------------------------------
# GET /content/{content_id}/related
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/content/{content_id}/related")
async def get_related_content(
    project_slug: str,
    content_id: str,
    top_k: int = Query(5, ge=1, le=50),
    kind: str | None = Query(None),
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Find semantically related content using the source row's stored embedding.

    Resolves the content row by UUID or wombat_id, then runs a cosine-similarity
    search using the stored embedding as the query vector.  The source row itself
    is excluded from the results.
    """
    from wombat_api.database.repository import Repository
    from wombat_api.search.hybrid import hybrid_search

    repo = Repository(session)

    # Resolve the source row
    if _is_wombat_id(content_id):
        from sqlalchemy import and_, select

        from wombat_api.database.models import Content

        q = select(Content).where(
            and_(
                Content.project_id == project.id,
                Content.wombat_id == content_id,
                Content.deleted_at.is_(None),
            )
        )
        row = (await session.execute(q)).scalar_one_or_none()
    else:
        try:
            uid = uuid.UUID(content_id)
        except ValueError as exc:
            raise HTTPException(422, f"Invalid content_id: {content_id!r}") from exc
        row = await repo.get_content_by_id(uid)
        if row is not None and row.project_id != project.id:
            row = None

    if row is None:
        raise HTTPException(404, "Content not found")

    if row.embedding is None:
        raise HTTPException(
            422,
            "Content row has no embedding — run `wombat sync` to index it.",
        )

    kinds = [kind] if kind else None
    try:
        hits = await hybrid_search(
            session,
            project_id=project.id,
            query=row.title or "",
            query_embedding=row.embedding,
            kinds=kinds,
            tags=None,
            top_k=top_k + 1,  # +1 so we can exclude the source row
            mode="semantic",
            include_chunks=False,
        )
    except NotImplementedError as exc:
        raise HTTPException(422, str(exc)) from exc

    # Exclude the source row from results
    source_id = str(row.id)
    hits = [h for h in hits if h.get("id") != source_id][:top_k]

    return {"hits": hits, "source_id": source_id, "total_returned": len(hits)}
