"""Search route — POST /{project_slug}/search — hybrid cosine + BM25 retrieval."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role
from wombat_api.search.hybrid import hybrid_search
from wombat_core.rag.embedders import load_embedder

router = APIRouter()

# Module-level embedder: loaded once at import time.
# The embedder is lazy-safe (load_embedder reads env vars at call time).
_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = load_embedder()
    return _embedder


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="The search query.")
    kinds: list[str] | None = Field(
        None,
        description="Filter by content kinds (e.g. ['testcase', 'doc']).",
    )
    tags: list[str] | None = Field(None, description="Filter by tags (all must match).")
    top_k: int = Field(10, ge=1, le=100, description="Number of results to return.")
    mode: Literal["hybrid", "semantic", "keyword"] = Field(
        "hybrid",
        description="Search mode: hybrid (cosine + BM25), semantic, or keyword.",
    )
    include_chunks: bool = Field(
        True,
        description="Whether to include chunk-level hits from doc content.",
    )


@router.post("/{project_slug}/search")
async def search(
    project_slug: str,
    req: SearchRequest,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Hybrid semantic + keyword search across project content.

    Returns:
        ``{"hits": [...], "query": "...", "mode": "..."}``
    """
    embedder = _get_embedder()
    try:
        vecs = await embedder.embed_batch([req.query])
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Embedder unavailable: {exc}",
        ) from exc

    try:
        hits = await hybrid_search(
            session,
            project_id=project.id,
            query=req.query,
            query_embedding=vecs[0],
            kinds=req.kinds,
            tags=req.tags,
            top_k=req.top_k,
            mode=req.mode,
            include_chunks=req.include_chunks,
        )
    except NotImplementedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "hits": hits,
        "query": req.query,
        "mode": req.mode,
        "total_returned": len(hits),
    }
