"""Run management and result ingestion routes.

Endpoints:
- POST   /{slug}/runs                          create run (editor+)
- GET    /{slug}/runs                          list runs paginated (viewer+)
- GET    /{slug}/runs/{run_id}                 run + summary (viewer+)
- PATCH  /{slug}/runs/{run_id}                 update status (editor+)
- POST   /{slug}/runs/{run_id}/results         add single result (editor+)
- POST   /{slug}/runs/{run_id}/results:bulk    JSON array ingest (editor+)
- POST   /{slug}/runs/{run_id}/ingest          JSONL streaming ingest (editor+)

Result matching: only `match_by="wombat_id"` is implemented for MVP.
Fuzzy matching is deferred (see deferred features list).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role
from wombat_api.schemas.common import ExecutionResultCreate, RunCreate

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_out(r) -> dict:
    return {
        "id": str(r.id),
        "project_id": str(r.project_id),
        "title": r.title,
        "plan_wombat_id": r.plan_wombat_id,
        "environment": r.environment,
        "triggered_by": r.triggered_by,
        "source": r.source,
        "status": r.status,
        "assignees": r.assignees,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
        "created_at": r.created_at.isoformat(),
    }


async def _resolve_content_id(
    repo: Repository, project_id: uuid.UUID,
):
    """Return a closure that resolves wombat_id → content.id."""

    async def _resolve(wombat_id: str) -> uuid.UUID | None:
        row = await repo.get_content_by_wombat_id(project_id, "testcase", wombat_id)
        return row.id if row is not None else None

    return _resolve


# ---------------------------------------------------------------------------
# Create run
# ---------------------------------------------------------------------------

@router.post("/{project_slug}/runs", status_code=201)
async def create_run(
    project_slug: str,
    body: RunCreate,
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
):
    from wombat_api.auth.dependencies import get_current_user
    # We need the user identity for triggered_by; retrieve it via the session.
    # require_role already authenticated the user; re-use the dependency inline.
    # For simplicity, use a sentinel when the identity is unavailable.
    repo = Repository(session)
    run = await repo.create_run(
        project_id=project.id, run=body, triggered_by="api",
    )
    await session.commit()
    return {"data": _run_out(run)}


# ---------------------------------------------------------------------------
# List runs
# ---------------------------------------------------------------------------

@router.get("/{project_slug}/runs")
async def list_runs(
    project_slug: str,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    runs = await repo.list_runs(project.id, limit=limit, offset=offset)
    return {
        "data": [_run_out(r) for r in runs],
        "pagination": {
            "limit": limit, "offset": offset,
            "has_more": len(runs) == limit,
        },
    }


# ---------------------------------------------------------------------------
# Get run + summary
# ---------------------------------------------------------------------------

@router.get("/{project_slug}/runs/{run_id}")
async def get_run(
    project_slug: str, run_id: uuid.UUID,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(404, "Run not found")
    summary = await repo.get_run_summary(run_id)
    return {
        "data": {
            **_run_out(run),
            "summary": summary.model_dump(),
        }
    }


# ---------------------------------------------------------------------------
# Update run status
# ---------------------------------------------------------------------------

@router.patch("/{project_slug}/runs/{run_id}")
async def update_run(
    project_slug: str, run_id: uuid.UUID,
    body: Annotated[dict, Body()],
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(404, "Run not found")
    if "status" in body:
        valid_statuses = {"pending", "running", "passed", "failed", "aborted"}
        if body["status"] not in valid_statuses:
            raise HTTPException(422, f"Invalid status. Valid: {valid_statuses}")
        await repo.update_run_status(run_id, body["status"])
    await session.commit()
    run = await repo.get_run(run_id)
    return {"data": _run_out(run)}


# ---------------------------------------------------------------------------
# Single result
# ---------------------------------------------------------------------------

@router.post("/{project_slug}/runs/{run_id}/results", status_code=201)
async def add_result(
    project_slug: str, run_id: uuid.UUID,
    body: ExecutionResultCreate,
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(404, "Run not found")
    resolver = await _resolve_content_id(repo, project.id)
    n = await repo.bulk_add_results(run_id, [body], resolver)
    await session.commit()
    if n == 0:
        raise HTTPException(422, f"Could not resolve testcase_id '{body.testcase_id}'")
    return {"data": {"created": n}}


# ---------------------------------------------------------------------------
# Bulk results (JSON array)
# ---------------------------------------------------------------------------

@router.post("/{project_slug}/runs/{run_id}/results:bulk", status_code=201)
async def bulk_results(
    project_slug: str, run_id: uuid.UUID,
    body: list[ExecutionResultCreate],
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(404, "Run not found")
    resolver = await _resolve_content_id(repo, project.id)
    n = await repo.bulk_add_results(run_id, body, resolver)
    await session.commit()
    return {"data": {"created": n, "total": len(body)}}


# ---------------------------------------------------------------------------
# JSONL streaming ingest
# ---------------------------------------------------------------------------

@router.post("/{project_slug}/runs/{run_id}/ingest", status_code=201)
async def ingest_jsonl(
    project_slug: str, run_id: uuid.UUID,
    request: Request,
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
):
    """Accept a JSONL body (one JSON object per line) as bulk result ingest.

    Each line must be a valid ExecutionResultCreate payload.
    Lines that fail to parse are counted as errors; processing continues.
    """
    import json

    repo = Repository(session)
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project.id:
        raise HTTPException(404, "Run not found")

    raw = await request.body()
    lines = [l.strip() for l in raw.decode("utf-8").splitlines() if l.strip()]
    results: list[ExecutionResultCreate] = []
    errors: list[dict] = []
    for i, line in enumerate(lines):
        try:
            data = json.loads(line)
            results.append(ExecutionResultCreate(**data))
        except Exception as exc:
            errors.append({"line": i + 1, "error": str(exc)})

    resolver = await _resolve_content_id(repo, project.id)
    n = await repo.bulk_add_results(run_id, results, resolver)
    await session.commit()
    return {
        "data": {
            "created": n,
            "total_lines": len(lines),
            "parse_errors": len(errors),
            "errors": errors[:20],  # cap to avoid huge payloads
        }
    }
