"""Sync route — POST /{project_slug}/sync triggers the indexer pipeline.

Also exposes:
- GET  /{project_slug}/sources   — list indexed source repos with freshness info
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.config import get_config
from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB, SyncLogDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role
from wombat_api.sync.indexer import Indexer
from wombat_core.rag.embedders import load_embedder

router = APIRouter()


class SyncRequest(BaseModel):
    test_repo_path: str = "."
    # app_repos and docs_folder come from wombat.toml read by the CLI.
    app_repos: list[dict] = []
    docs_folder: str | None = None


@router.post("/{project_slug}/sync")
async def trigger_sync(
    project_slug: str,
    req: SyncRequest,
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Trigger an index sync for the project.

    Body fields:
    - ``test_repo_path``: path to the Git repo containing entity Markdown files.
    - ``app_repos``: list of ``AppRepoSource`` dicts (name, repo, ref, include).
    - ``docs_folder``: optional sub-path within sources_root to treat as docs.
    """
    from wombat_core.config.models import AppRepoSource

    cfg = get_config()
    repo = Repository(session)
    embedder = load_embedder()
    indexer = Indexer(
        repository=repo,
        embedder=embedder,
        batch_size=100,
        chunk_size_tokens=500,
        chunk_overlap_tokens=50,
    )
    progress = await indexer.sync_project(
        project_id=project.id,
        test_repo_root=Path(req.test_repo_path),
        sources_root=Path(cfg.sources_root),
        app_repos=[AppRepoSource(**a) for a in req.app_repos],
        docs_folder=req.docs_folder,
    )
    session.add(
        SyncLogDB(
            project_id=project.id,
            source_repo="test-repo",
            revision="aggregate",
            entities_created=progress.seen,
            entities_updated=0,
            entities_deleted=0,
            entities_skipped=progress.skipped,
            errors=progress.errors,
            duration_ms=0,
        )
    )
    await session.commit()
    return {
        "total": progress.total,
        "embedded": progress.embedded,
        "skipped": progress.skipped,
        "errors": len(progress.errors),
    }


# ---------------------------------------------------------------------------
# List sources
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/sources")
async def list_sources(
    project_slug: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return distinct source repos with last synced revision and timestamp.

    Aggregates ``source_repo``, ``MAX(source_revision)``, and ``MAX(synced_at)``
    from the ``content`` table for the given project.

    Response shape::

        {"sources": [
            {
                "source_repo": "...",
                "last_synced_revision": "...",
                "last_synced_at": "ISO-8601 timestamp"
            },
            ...
        ]}
    """
    from sqlalchemy import func, select

    from wombat_api.database.models import Content

    q = (
        select(
            Content.source_repo,
            func.max(Content.source_revision).label("last_synced_revision"),
            func.max(Content.synced_at).label("last_synced_at"),
        )
        .where(
            Content.project_id == project.id,
            Content.deleted_at.is_(None),
        )
        .group_by(Content.source_repo)
        .order_by(Content.source_repo)
    )
    rows = (await session.execute(q)).all()
    sources = [
        {
            "source_repo": r.source_repo,
            "last_synced_revision": r.last_synced_revision,
            "last_synced_at": r.last_synced_at.isoformat() if r.last_synced_at else None,
        }
        for r in rows
    ]
    return {"sources": sources}
