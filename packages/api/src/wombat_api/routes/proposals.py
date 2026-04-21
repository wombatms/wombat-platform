"""Proposal routes: create / read / update / approve / reject / withdraw."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProposalDB, ProposalEventDB
from wombat_api.database.repository import (
    OpenProposalExistsError,
    ProposalFilters,
    ProposalNotOpenError,
    Repository,
    StaleBaseRevisionError,
)
from wombat_api.proposals.publisher import (
    ConflictError,
    PushRejectedError,
    publish_proposal,
)
from wombat_api.rbac.guards import forbid_self_approval, require_direct_publish
from wombat_api.rbac.middleware import require_permission
from wombat_api.rbac.permissions import Permission
from wombat_api.schemas.proposals import (
    ProposalAction,
    ProposalCreate,
    ProposalDetailResponse,
    ProposalEventResponse,
    ProposalResponse,
    ProposalSummaryResponse,
    ProposalUpdate,
)

router = APIRouter(prefix="/api/projects/{project_slug}/proposals", tags=["proposals"])


@router.post("", status_code=201)
async def create_proposal(
    body: ProposalCreate,
    auto_approve: bool = Query(False),
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, role = authctx
    require_direct_publish(principal, role, auto_approve)

    repo = Repository(session)
    try:
        proposal = await repo.create_proposal(
            project_id=project.id,
            content_id=body.content_id,
            kind=body.kind,
            source_path=body.source_path,
            base_revision=body.base_revision,
            proposed_title=body.proposed_title,
            proposed_body=body.proposed_body,
            proposal_action=body.proposal_action,
            summary=body.summary,
            author_user_id=principal.user.id,
            author_kind=principal.kind,
        )
    except OpenProposalExistsError as e:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "open_proposal_exists",
                "message": "An open proposal already exists for this content.",
                "existing_proposal_id": str(e.existing_proposal_id),
            },
        ) from e
    await repo.append_proposal_event(proposal_id=proposal.id, user_id=principal.user.id, action="created")

    if auto_approve:
        try:
            result = await publish_proposal(
                session,
                project=project,
                proposal=proposal,
                approver=principal,
                author_user=principal.user,
                action="direct_publish",
                comment=None,
            )
        except ConflictError as e:
            await repo.transition_proposal_status(proposal.id, new_status="conflict")
            await repo.append_proposal_event(
                proposal_id=proposal.id,
                user_id=principal.user.id,
                action="conflict_detected",
                detail={"current_sha": e.current_sha},
            )
            await session.commit()
            raise HTTPException(
                status_code=409,
                detail={"code": "stale_base_revision", "current_sha": e.current_sha},
            ) from e
        except PushRejectedError as e:
            await repo.transition_proposal_status(proposal.id, new_status="conflict")
            await session.commit()
            raise HTTPException(
                status_code=502,
                detail={"code": "push_failed", "stderr": e.stderr},
            ) from e
        await repo.transition_proposal_status(proposal.id, new_status="published", published_sha=result.published_sha)
        await repo.append_proposal_event(
            proposal_id=proposal.id,
            user_id=principal.user.id,
            action="direct_published",
            detail={"purpose": principal.token.purpose if principal.token else None},
        )
        await session.commit()
        # Refresh is required because `updated_at` uses `onupdate=func.now()`
        # which SQLAlchemy marks as expired after the ORM flush/commit cycle.
        # Without refresh, accessing `proposal.updated_at` triggers a lazy-load
        # in an async context, raising MissingGreenlet.
        await session.refresh(proposal)
        return {
            "data": {
                "proposal": _proposal_to_response(proposal).model_dump(),
                "published_sha": result.published_sha,
            }
        }

    await session.commit()
    await session.refresh(proposal)
    return {"data": {"proposal": _proposal_to_response(proposal).model_dump()}}


@router.get("")
async def list_proposals(
    status: str | None = Query("open"),
    kind: str | None = None,
    author_user_id: str | None = None,
    author_kind: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, le=200),
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, _, _ = authctx
    repo = Repository(session)
    filters = ProposalFilters(
        status=status,
        kind=kind,
        author_user_id=uuid.UUID(author_user_id) if author_user_id else None,
        author_kind=author_kind,
        cursor=cursor,
        limit=limit,
    )
    rows, next_cursor = await repo.list_proposals(project_id=project.id, filters=filters)
    items = [_proposal_to_summary(p).model_dump() for p in rows]
    return {"data": items, "pagination": {"next_cursor": next_cursor}}


@router.get("/{proposal_id}")
async def get_proposal_detail(
    proposal_id: str,
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, _, _ = authctx
    repo = Repository(session)
    result = await repo.get_proposal_with_events(uuid.UUID(proposal_id))
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "proposal_not_found"})
    proposal, events = result
    before = None
    if proposal.content_id:
        content = await repo.get_content(proposal.content_id)
        before = content.body if content else None
    return {
        "data": ProposalDetailResponse(
            proposal=_proposal_to_response(proposal),
            before=before,
            after=proposal.proposed_body,
            events=[_event_to_response(e) for e in events],
        ).model_dump()
    }


@router.put("/{proposal_id}")
async def update_proposal(
    proposal_id: str,
    body: ProposalUpdate,
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _ = authctx
    repo = Repository(session)
    existing = await repo.get_proposal(uuid.UUID(proposal_id))
    if existing is None or existing.project_id != project.id:
        raise HTTPException(status_code=404, detail={"code": "proposal_not_found"})
    if existing.author_user_id != principal.user.id:
        raise HTTPException(status_code=403, detail={"code": "not_author"})
    try:
        updated = await repo.update_proposal_body(
            existing.id,
            proposed_title=body.proposed_title,
            proposed_body=body.proposed_body,
            summary=body.summary,
            base_revision=body.base_revision,
        )
    except ProposalNotOpenError as e:
        raise HTTPException(
            status_code=409,
            detail={"code": "proposal_not_open", "status": e.status},
        ) from e
    except StaleBaseRevisionError as e:
        raise HTTPException(
            status_code=409,
            detail={"code": "stale_base_revision", "current": e.current},
        ) from e
    await repo.append_proposal_event(proposal_id=existing.id, user_id=principal.user.id, action="updated")
    await session.commit()
    return {"data": _proposal_to_response(updated).model_dump()}


@router.delete("/{proposal_id}", status_code=204)
async def withdraw_proposal(
    proposal_id: str,
    authctx=Depends(require_permission(Permission.CONTENT_PROPOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _ = authctx
    repo = Repository(session)
    p = await repo.get_proposal(uuid.UUID(proposal_id))
    if p is None or p.project_id != project.id:
        raise HTTPException(status_code=404, detail={"code": "proposal_not_found"})
    if p.author_user_id != principal.user.id:
        raise HTTPException(status_code=403, detail={"code": "not_author"})
    await repo.transition_proposal_status(p.id, new_status="withdrawn")
    await repo.append_proposal_event(proposal_id=p.id, user_id=principal.user.id, action="withdrawn")
    await session.commit()


@router.post("/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: str,
    body: ProposalAction,
    authctx=Depends(require_permission(Permission.CONTENT_PUBLISH_DIRECT)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _ = authctx
    repo = Repository(session)
    proposal = await repo.get_proposal(uuid.UUID(proposal_id))
    if proposal is None or proposal.project_id != project.id:
        raise HTTPException(status_code=404, detail={"code": "proposal_not_found"})
    forbid_self_approval(proposal, principal)

    author_user = await repo.get_user(proposal.author_user_id)
    try:
        result = await publish_proposal(
            session,
            project=project,
            proposal=proposal,
            approver=principal,
            author_user=author_user,
            action="approve",
            comment=body.comment,
        )
    except ConflictError as e:
        await repo.transition_proposal_status(proposal.id, new_status="conflict")
        await repo.append_proposal_event(
            proposal_id=proposal.id,
            user_id=principal.user.id,
            action="conflict_detected",
            detail={"current_sha": e.current_sha},
        )
        await session.commit()
        raise HTTPException(
            status_code=409,
            detail={"code": "stale_base_revision", "current_sha": e.current_sha},
        ) from e
    except PushRejectedError as e:
        await repo.transition_proposal_status(proposal.id, new_status="conflict")
        await session.commit()
        raise HTTPException(
            status_code=502,
            detail={"code": "push_failed", "stderr": e.stderr},
        ) from e

    await repo.transition_proposal_status(proposal.id, new_status="published", published_sha=result.published_sha)
    await repo.append_proposal_event(
        proposal_id=proposal.id,
        user_id=principal.user.id,
        action="approved",
        comment=body.comment,
    )
    await session.commit()
    await session.refresh(proposal)
    return {
        "data": {
            "proposal": _proposal_to_response(proposal).model_dump(),
            "published_sha": result.published_sha,
        }
    }


@router.post("/{proposal_id}/reject")
async def reject_proposal(
    proposal_id: str,
    body: ProposalAction,
    authctx=Depends(require_permission(Permission.CONTENT_PUBLISH_DIRECT)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _ = authctx
    repo = Repository(session)
    p = await repo.get_proposal(uuid.UUID(proposal_id))
    if p is None or p.project_id != project.id:
        raise HTTPException(status_code=404, detail={"code": "proposal_not_found"})
    forbid_self_approval(p, principal)
    if p.status != "open":
        raise HTTPException(
            status_code=409,
            detail={"code": "proposal_not_open", "status": p.status},
        )
    await repo.transition_proposal_status(p.id, new_status="rejected")
    await repo.append_proposal_event(
        proposal_id=p.id,
        user_id=principal.user.id,
        action="rejected",
        comment=body.comment,
    )
    await session.commit()
    return {"data": _proposal_to_response(p).model_dump()}


# ---- converters ---------------------------------------------------------


def _proposal_to_response(p: ProposalDB) -> ProposalResponse:
    return ProposalResponse(
        id=p.id,
        project_id=p.project_id,
        content_id=p.content_id,
        kind=p.kind,
        source_path=p.source_path,
        base_revision=p.base_revision,
        proposed_title=p.proposed_title,
        proposed_body=p.proposed_body,
        proposal_action=p.proposal_action,
        summary=p.summary,
        author_user_id=p.author_user_id,
        author_kind=p.author_kind,
        status=p.status,
        published_sha=p.published_sha,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _proposal_to_summary(p: ProposalDB) -> ProposalSummaryResponse:
    # Change-size hint: cheap approximation from markdown length.
    markdown_len = len((p.proposed_body or {}).get("markdown", ""))
    return ProposalSummaryResponse(
        id=p.id,
        kind=p.kind,
        source_path=p.source_path,
        proposed_title=p.proposed_title,
        author_user_id=p.author_user_id,
        author_kind=p.author_kind,
        status=p.status,
        created_at=p.created_at,
        change_added=markdown_len // 40,
        change_removed=0,
    )


def _event_to_response(e: ProposalEventDB) -> ProposalEventResponse:
    return ProposalEventResponse(
        id=e.id,
        action=e.action,
        user_id=e.user_id,
        comment=e.comment,
        detail=e.detail,
        created_at=e.created_at,
    )
