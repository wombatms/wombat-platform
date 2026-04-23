"""Plan read routes + SP3.4 extensions (clone, resolve, start-run).

Write endpoints (create/update/delete) are omitted by design — writes flow
through the SP3.2 proposal path (POST /proposals with kind='plan').

SP3.4 additions (Task 8):
- GET  /{project_slug}/plans/{wombat_id}/resolve   — returns ResolvedPlan
- POST /{project_slug}/plans/{wombat_id}/clone     — creates a proposal cloning the plan
- POST /{project_slug}/plans/{wombat_id}/start-run — returns StartRunDraft (no run created)
"""

from __future__ import annotations

import copy

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.database.repository import OpenProposalExistsError, Repository
from wombat_api.rbac.middleware import require_permission, require_role
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission

router = APIRouter()
KIND = "plan"


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


@router.get("/{project_slug}/plans")
async def list_plans(
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


@router.get("/{project_slug}/plans/{wombat_id}")
async def get_plan(
    project_slug: str,
    wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    repo = Repository(session)
    row = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if row is None:
        raise HTTPException(404, "Plan not found")
    return {"data": _row_out(row)}


# ---------------------------------------------------------------------------
# SP3.4: GET /{project_slug}/plans/{wombat_id}/resolve
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/plans/{wombat_id}/resolve")
async def resolve_plan(
    project_slug: str,
    wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Return the ResolvedPlan for the published plan body.

    Loads the most-recent published plan content row and runs it through
    ResolveService.  No draft body is accepted here; use
    POST /{project_slug}/content/resolve for draft-preview.

    Permissions: viewer or higher (content read is authenticated + project-scoped).
    """
    repo = Repository(session)
    row = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if row is None:
        raise HTTPException(404, detail={"code": "plan_not_found", "message": "Plan not found"})

    from wombat_api.planning.service import ResolveService

    svc = ResolveService(repo)
    resolved = await svc.resolve_plan(project.id, row.body or {})
    return {"data": resolved.model_dump()}


# ---------------------------------------------------------------------------
# SP3.4: POST /{project_slug}/plans/{wombat_id}/clone
# ---------------------------------------------------------------------------


class ClonePlanRequest(BaseModel):
    new_wombat_id: str
    title: str | None = None


@router.post("/{project_slug}/plans/{wombat_id}/clone", status_code=201)
async def clone_plan(
    project_slug: str,
    wombat_id: str,
    body: ClonePlanRequest,
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    """Deep-copy a plan body into a new proposal with a new wombat_id.

    The clone is submitted as a proposal with kind='plan'.  The caller must
    have content:propose permission (editor or admin by default).

    The resulting proposal is open and waiting for review/approval through the
    existing SP3.2 proposal flow.

    Permissions: content:propose (editor+)
    """
    project, principal, role = authctx
    repo = Repository(session)

    # Load source plan.
    src = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if src is None:
        raise HTTPException(404, detail={"code": "plan_not_found", "message": "Plan not found"})

    # Deep-copy the body and apply overrides.
    new_body = copy.deepcopy(src.body or {})
    src_title: str = src.title or new_body.get("title") or wombat_id
    clone_title = body.title if body.title else f"{src_title} (clone)"
    new_body["title"] = clone_title

    # Derive the source path from the new wombat_id (convention: plans/<wid>.md).
    new_source_path = f"plans/{body.new_wombat_id}.md"

    try:
        proposal = await repo.create_proposal(
            project_id=project.id,
            content_id=None,  # new file — no existing content row
            kind=KIND,
            source_path=new_source_path,
            base_revision=src.source_revision,
            proposed_title=clone_title,
            proposed_body=new_body,
            proposal_action="upsert",
            summary=f"Clone of {wombat_id}",
            author_user_id=principal.user.id,
            author_kind=principal.kind,
        )
    except OpenProposalExistsError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "open_proposal_exists",
                "message": "An open proposal already exists for this plan.",
                "existing_proposal_id": str(e.existing_proposal_id),
            },
        ) from e

    await repo.append_proposal_event(proposal_id=proposal.id, user_id=principal.user.id, action="created")
    await session.commit()
    await session.refresh(proposal)

    return {
        "data": {
            "proposal": {
                "id": str(proposal.id),
                "project_id": str(proposal.project_id),
                "content_id": str(proposal.content_id) if proposal.content_id else None,
                "kind": proposal.kind,
                "source_path": proposal.source_path,
                "base_revision": proposal.base_revision,
                "proposed_title": proposal.proposed_title,
                "proposed_body": proposal.proposed_body,
                "proposal_action": proposal.proposal_action,
                "summary": proposal.summary,
                "author_user_id": str(proposal.author_user_id),
                "author_kind": proposal.author_kind,
                "status": proposal.status,
                "published_sha": proposal.published_sha,
                "created_at": proposal.created_at.isoformat(),
                "updated_at": proposal.updated_at.isoformat(),
            }
        }
    }


# ---------------------------------------------------------------------------
# SP3.4: POST /{project_slug}/plans/{wombat_id}/start-run
# ---------------------------------------------------------------------------


@router.post("/{project_slug}/plans/{wombat_id}/start-run")
async def start_run_draft(
    project_slug: str,
    wombat_id: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """Return a pre-filled run-creation draft derived from the plan.

    Does NOT create a run.  The caller passes the returned StartRunDraft to
    POST /runs to actually create the run.  This endpoint only hydrates the
    run-create form with the plan's environments, assignees, and resolved case
    count.

    Permissions: viewer or higher (content read is authenticated + project-scoped).
    """
    repo = Repository(session)
    row = await repo.get_content_by_wombat_id(project.id, KIND, wombat_id)
    if row is None:
        raise HTTPException(404, detail={"code": "plan_not_found", "message": "Plan not found"})

    body = row.body or {}
    plan_title: str = row.title or body.get("title") or wombat_id
    title_suggestion = f"Run: {plan_title}"

    # Resolve case count without returning the full list (just for the form hint).
    from wombat_api.planning.service import ResolveService

    svc = ResolveService(repo)
    resolved = await svc.resolve_plan(project.id, body)
    case_count = resolved.count

    from wombat_api.planning.schemas import StartRunDraft

    draft = StartRunDraft(
        plan_wombat_id=wombat_id,
        plan_revision=row.source_revision,
        title_suggestion=title_suggestion,
        environments=list(body.get("environments") or []),
        assignees=list(body.get("assignees") or []),
        case_count=case_count,
    )
    return {"data": draft.model_dump()}
