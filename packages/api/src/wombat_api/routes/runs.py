"""Run lifecycle routes for SP3.3.

Covers:
  Task 18 — POST /projects/{slug}/runs, GET /projects/{slug}/runs,
             GET /projects/{slug}/runs/{id}
  Task 19 — PATCH run, cases add/remove, close, reopen, rerun
  Task 20 — results CRUD (batch POST, PUT If-Match, DELETE)
  Task 21 — evidence upload + delete  (GET /evidence/{id}/url lives in routes/evidence.py)
  Task 22 — run events (paginated audit log)

Route handlers are thin: parse request → call repository / service → format response.
Domain exceptions bubble up to the app-level exception handlers registered in app.py.
"""

from __future__ import annotations

import io
import uuid as _uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import (
    EnvironmentDB,
    RunAssigneeDB,
    RunCaseDB,
    RunDB,
)
from wombat_api.database.repository import Repository, _encode_event_cursor
from wombat_api.evidence.deps import get_evidence_backend
from wombat_api.rbac.middleware import require_permission
from wombat_api.rbac.permissions import Permission
from wombat_api.rbac.run_guards import assert_run_actor_authorized
from wombat_api.runs.exceptions import (
    CaseAlreadyInRunError,
    CaseNotInRunError,
    EnvironmentNotFoundError,
    ResultConflictError,
    RunClosedError,
    RunNotFoundError,
    RunNotOpenError,
)
from wombat_api.runs.schemas import (
    ActorRef,
    AddCasesRequest,
    AssigneeRef,
    CloseRunRequest,
    CreateRunRequest,
    EvidenceOut,
    EventOut,
    PatchRunRequest,
    PutResultRequest,
    RecordResultBatchResponseItem,
    RecordResultItem,
    RerunRequest,
    ResultOut,
    RunCounts,
    RunDetailOut,
    RunOut,
)
from wombat_api.runs.service import RunService

router = APIRouter()

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _get_run_or_404(
    repo: Repository,
    *,
    project_id: _uuid.UUID,
    run_id_str: str,
) -> RunDB:
    """Parse run_id and fetch the run, raising RunNotFoundError if missing or
    not in this project."""
    try:
        run_id = _uuid.UUID(run_id_str)
    except ValueError:
        raise RunNotFoundError()
    run = await repo.get_run(run_id)
    if run is None or run.project_id != project_id:
        raise RunNotFoundError()
    return run


async def _build_run_counts(repo: Repository, run_id: _uuid.UUID) -> RunCounts:
    buckets = await repo.count_results_by_status(run_id)
    total = sum(buckets.values())
    return RunCounts(
        total=total,
        **{"pass_": buckets.get("pass", 0)},
        fail=buckets.get("fail", 0),
        blocked=buckets.get("blocked", 0),
        skipped=buckets.get("skipped", 0),
        not_run=buckets.get("not_run", 0),
    )


async def _build_run_detail(
    repo: Repository,
    run: RunDB,
    env_name: str | None = None,
) -> RunDetailOut:
    """Build a RunDetailOut from a RunDB row."""
    counts = await _build_run_counts(repo, run.id)

    # Fetch assignees
    assignee_rows: list[RunAssigneeDB] = await repo.list_assignees(run.id)
    assignees: list[AssigneeRef] = []
    for a in assignee_rows:
        if a.user_id is not None:
            assignees.append(AssigneeRef(principal_type="user", id=a.user_id))
        elif a.token_id is not None:
            assignees.append(AssigneeRef(principal_type="token", id=a.token_id))

    # Resolve environment name if not provided
    if env_name is None and run.environment_id is not None:
        env = await repo.session.get(EnvironmentDB, run.environment_id)
        env_name = env.name if env else None

    return RunDetailOut(
        id=run.id,
        title=run.title,
        status=run.status,
        environment_id=run.environment_id,
        environment_name=env_name,
        owner_id=run.owner_id,
        created_at=run.created_at,
        updated_at=run.updated_at,
        started_at=run.started_at,
        closed_at=run.closed_at,
        closure_note=run.closure_note,
        counts=counts,
        source=run.source,
        parent_run_id=run.parent_run_id,
        assignees=assignees,
    )


async def _build_run_out(repo: Repository, run: RunDB) -> RunOut:
    counts = await _build_run_counts(repo, run.id)
    env_name: str | None = None
    if run.environment_id is not None:
        env = await repo.session.get(EnvironmentDB, run.environment_id)
        env_name = env.name if env else None
    return RunOut(
        id=run.id,
        title=run.title,
        status=run.status,
        environment_id=run.environment_id,
        environment_name=env_name,
        owner_id=run.owner_id,
        created_at=run.created_at,
        updated_at=run.updated_at,
        counts=counts,
        source=run.source,
        parent_run_id=run.parent_run_id,
    )


# ---------------------------------------------------------------------------
# Task 18 — POST /projects/{slug}/runs (create)
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs", status_code=201)
async def create_run(
    project_slug: str,
    body: CreateRunRequest,
    authctx=Depends(require_permission(Permission.RUNS_CREATE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    # Validate environment_id if provided
    if body.environment_id is not None:
        env = await session.get(EnvironmentDB, body.environment_id)
        if env is None or env.project_id != project.id:
            raise EnvironmentNotFoundError()

    svc = RunService(session)
    run = await svc.create_run(
        project_id=project.id,
        owner_id=principal.user.id,
        title=body.title,
        case_selection=body.case_selection,
        environment_id=body.environment_id,
        source=body.source,
    )

    # Add assignees
    for uid in body.assignee_user_ids:
        await repo.add_assignee(
            run_id=run.id,
            user_id=uid,
            added_by_user_id=principal.user.id,
        )
    for tid in body.assignee_token_ids:
        await repo.add_assignee(
            run_id=run.id,
            token_id=tid,
            added_by_user_id=principal.user.id,
        )

    await session.commit()
    await session.refresh(run)

    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 18 — GET /projects/{slug}/runs (list)
# ---------------------------------------------------------------------------


@router.get("/api/projects/{project_slug}/runs")
async def list_runs(
    project_slug: str,
    status: str | None = Query(None),
    environment_id: _uuid.UUID | None = Query(None),
    owner_id: _uuid.UUID | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
):
    project, _principal, _role = authctx
    repo = Repository(session)

    runs = await repo.list_runs(
        project_id=project.id,
        status=status,
        environment_id=environment_id,
        owner_id=owner_id,
        q=q,
        limit=limit + 1,  # fetch one extra to detect next page
        cursor=cursor,
    )

    next_cursor: str | None = None
    if len(runs) > limit:
        from wombat_api.database.repository import _encode_cursor
        next_cursor = _encode_cursor(runs[limit - 1].created_at)
        runs = runs[:limit]

    run_outs = []
    for run in runs:
        run_outs.append((await _build_run_out(repo, run)).model_dump(mode="json"))

    return {"data": run_outs, "next_cursor": next_cursor}


# ---------------------------------------------------------------------------
# Task 18 — GET /projects/{slug}/runs/{id} (get detail)
# ---------------------------------------------------------------------------


@router.get("/api/projects/{project_slug}/runs/{run_id}")
async def get_run(
    project_slug: str,
    run_id: str,
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
):
    project, _principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)
    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 19 — PATCH /projects/{slug}/runs/{id} (edit title/env/assignees)
# ---------------------------------------------------------------------------


@router.patch("/api/projects/{project_slug}/runs/{run_id}")
async def patch_run(
    project_slug: str,
    run_id: str,
    body: PatchRunRequest,
    authctx=Depends(require_permission(Permission.RUNS_CLOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    # CI-account gate
    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunNotOpenError()

    # Apply updates
    if body.title is not None:
        run.title = body.title
    if body.environment_id is not None:
        env = await session.get(EnvironmentDB, body.environment_id)
        if env is None or env.project_id != project.id:
            raise EnvironmentNotFoundError()
        run.environment_id = body.environment_id

    # Sync assignees if provided
    if body.assignee_user_ids is not None or body.assignee_token_ids is not None:
        # Remove all existing assignees
        existing = await repo.list_assignees(run.id)
        for a in existing:
            await repo.remove_assignee(a.id)
        # Add new ones
        for uid in (body.assignee_user_ids or []):
            await repo.add_assignee(
                run_id=run.id,
                user_id=uid,
                added_by_user_id=principal.user.id,
            )
        for tid in (body.assignee_token_ids or []):
            await repo.add_assignee(
                run_id=run.id,
                token_id=tid,
                added_by_user_id=principal.user.id,
            )

    await session.flush()
    await session.commit()
    await session.refresh(run)

    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 19 — POST /projects/{slug}/runs/{id}/cases (add cases)
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs/{run_id}/cases")
async def add_cases(
    project_slug: str,
    run_id: str,
    body: AddCasesRequest,
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    # Resolve selection — reuse RunService helper
    svc = RunService(session)
    cases = await svc._resolve_case_selection(project.id, body.case_selection)

    # Check for existing snapshots to detect duplicates
    from wombat_api.runs.service import _resolve_and_hash
    existing_pairs = await repo.list_run_cases_with_snapshots(run.id)
    existing_hashes: set[str] = {snap.content_hash for _rc, snap in existing_pairs}

    start_order = len(existing_pairs)
    added_count = 0
    for content in cases:
        resolved_body, content_hash = await _resolve_and_hash(content, session)
        if content_hash in existing_hashes:
            raise CaseAlreadyInRunError()
        snap = await repo.upsert_run_case_snapshot(
            content=content,
            resolved_body=resolved_body,
            content_hash=content_hash,
        )
        await repo.add_run_case(
            run_id=run.id,
            snapshot_id=snap.id,
            display_order=start_order + added_count,
            added_by_user_id=principal.user.id,
        )
        await repo.append_event(
            run_id=run.id,
            event_type="case_added",
            payload={"case_id": snap.snapshot_wombat_id, "snapshot_hash": snap.content_hash},
            actor_user_id=principal.user.id,
        )
        existing_hashes.add(content_hash)
        added_count += 1

    await session.commit()
    await session.refresh(run)

    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 19 — DELETE /projects/{slug}/runs/{id}/cases/{run_case_id}
# ---------------------------------------------------------------------------


@router.delete("/api/projects/{project_slug}/runs/{run_id}/cases/{run_case_id}", status_code=204)
async def remove_case(
    project_slug: str,
    run_id: str,
    run_case_id: str,
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    try:
        rc_id = _uuid.UUID(run_case_id)
    except ValueError:
        raise CaseNotInRunError()

    run_case = await session.get(RunCaseDB, rc_id)
    if run_case is None or run_case.run_id != run.id:
        raise CaseNotInRunError()

    # Check no result recorded
    result = await repo.get_result(run_id=run.id, run_case_id=rc_id)
    if result is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "case_has_result", "message": "Cannot remove a case that has a recorded result."},
        )

    # Get snapshot wombat_id before deletion for the event
    from wombat_api.database.models import RunCaseSnapshotDB
    snap = await session.get(RunCaseSnapshotDB, run_case.snapshot_id)

    await repo.remove_run_case(rc_id)
    await repo.append_event(
        run_id=run.id,
        event_type="case_removed",
        payload={"run_case_id": str(rc_id), "case_id": snap.snapshot_wombat_id if snap else ""},
        actor_user_id=principal.user.id,
    )

    await session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Task 19 — POST /projects/{slug}/runs/{id}/close
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs/{run_id}/close")
async def close_run(
    project_slug: str,
    run_id: str,
    body: CloseRunRequest,
    authctx=Depends(require_permission(Permission.RUNS_CLOSE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    svc = RunService(session)
    run = await svc.close_run(
        run,
        reason=body.reason,
        note=body.note,
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    await session.refresh(run)

    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 19 — POST /projects/{slug}/runs/{id}/reopen
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs/{run_id}/reopen")
async def reopen_run(
    project_slug: str,
    run_id: str,
    authctx=Depends(require_permission(Permission.RUNS_REOPEN)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    svc = RunService(session)
    run = await svc.reopen_run(
        run,
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    await session.refresh(run)

    detail = await _build_run_detail(repo, run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 19 — POST /projects/{slug}/runs/{id}/reruns
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs/{run_id}/reruns", status_code=201)
async def rerun(
    project_slug: str,
    run_id: str,
    body: RerunRequest,
    authctx=Depends(require_permission(Permission.RUNS_CREATE)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    parent_run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    svc = RunService(session)

    if body.include_statuses is None and body.case_ids is None:
        # Default: rerun failed + blocked
        new_run = await svc.rerun_failed(parent_run, owner_id=principal.user.id)
    else:
        new_run = await svc.rerun(
            parent_run,
            owner_id=principal.user.id,
            case_ids=body.case_ids,
            include_statuses=set(body.include_statuses) if body.include_statuses else None,
        )

    await session.commit()
    await session.refresh(new_run)

    detail = await _build_run_detail(repo, new_run)
    return {"data": detail.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# Task 20 — POST /projects/{slug}/runs/{id}/results (batch)
# ---------------------------------------------------------------------------


@router.post("/api/projects/{project_slug}/runs/{run_id}/results")
async def batch_record_results(
    project_slug: str,
    run_id: str,
    body: list[RecordResultItem],
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    svc = RunService(session)
    results = await svc.record_result_batch(
        run=run,
        items=body,
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
        source=principal.kind,
    )

    await session.commit()

    return {"results": [r.model_dump(mode="json") for r in results]}


# ---------------------------------------------------------------------------
# Task 20 — GET /projects/{slug}/runs/{id}/results (list)
# ---------------------------------------------------------------------------


@router.get("/api/projects/{project_slug}/runs/{run_id}/results")
async def list_results(
    project_slug: str,
    run_id: str,
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
):
    project, _principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    results = await repo.list_results(run_id=run.id, status=status)

    # Apply cursor/limit manually (list_results is simple; full pagination to be added later)
    results_out = []
    for r in results[:limit]:
        actor: ActorRef | None = None
        if r.recorded_by_user_id:
            actor = ActorRef(principal_type="user", id=r.recorded_by_user_id)
        elif r.recorded_by_token_id:
            actor = ActorRef(principal_type="token", id=r.recorded_by_token_id)

        # Look up the run_case's wombat_id via snapshot
        from wombat_api.database.models import RunCaseDB as _RunCaseDB, RunCaseSnapshotDB as _SnapDB
        from sqlalchemy import select as _select, and_ as _and
        stmt = (
            _select(_RunCaseDB, _SnapDB)
            .join(_SnapDB, _RunCaseDB.snapshot_id == _SnapDB.id)
            .where(_RunCaseDB.id == r.run_case_id)
        )
        pair = (await session.execute(stmt)).one_or_none()
        case_wid = pair[1].snapshot_wombat_id if pair else str(r.run_case_id)

        results_out.append(
            ResultOut(
                id=r.id,
                run_case_id=r.run_case_id,
                case_id=case_wid,
                status=r.status,
                revision=r.revision,
                notes=r.notes,
                failed_at_step=r.failed_at_step,
                bug_links=r.bug_links or [],
                duration_ms=r.duration_ms,
                recorded_by=actor,
                source=r.source,
                created_at=r.created_at,
                updated_at=r.updated_at,
            ).model_dump(mode="json")
        )

    return {"data": results_out}


# ---------------------------------------------------------------------------
# Task 20 — PUT /projects/{slug}/runs/{id}/results/{case_id} (single update)
# ---------------------------------------------------------------------------


@router.put("/api/projects/{project_slug}/runs/{run_id}/results/{case_id}")
async def put_result(
    project_slug: str,
    run_id: str,
    case_id: str,
    body: PutResultRequest,
    if_match: Annotated[str | None, Header(alias="if-match")] = None,
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    # Find the run_case by wombat_id
    run_case = await repo.get_run_case_by_wombat_id(run_id=run.id, wombat_id=case_id)
    if run_case is None:
        raise CaseNotInRunError()

    # Parse If-Match revision
    expected_revision: int | None = None
    if if_match is not None:
        try:
            expected_revision = int(if_match.strip('"'))
        except ValueError:
            raise HTTPException(status_code=400, detail={"code": "invalid_if_match", "message": "If-Match must be an integer revision."})

    try:
        result = await repo.upsert_result(
            run_id=run.id,
            run_case_id=run_case.id,
            status=body.status,
            source=principal.kind,
            recorded_by_user_id=principal.user.id,
            recorded_by_token_id=principal.token.id if principal.token else None,
            notes=body.notes,
            failed_at_step=body.failed_at_step,
            bug_links=[bl.model_dump() for bl in body.bug_links],
            duration_ms=body.duration_ms,
            expected_revision=expected_revision,
        )
    except ResultConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "result_conflict",
                "message": f"revision conflict; current={exc.current_revision}",
                "current_revision": exc.current_revision,
            },
        )

    event_type = "result_recorded" if result.revision == 1 else "result_updated"
    await repo.append_event(
        run_id=run.id,
        event_type=event_type,
        payload={"case_id": case_id, "status": body.status, "revision": result.revision},
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    await session.refresh(result)

    actor: ActorRef | None = ActorRef(principal_type="user", id=principal.user.id)
    return {
        "data": ResultOut(
            id=result.id,
            run_case_id=result.run_case_id,
            case_id=case_id,
            status=result.status,
            revision=result.revision,
            notes=result.notes,
            failed_at_step=result.failed_at_step,
            bug_links=result.bug_links or [],
            duration_ms=result.duration_ms,
            recorded_by=actor,
            source=result.source,
            created_at=result.created_at,
            updated_at=result.updated_at,
        ).model_dump(mode="json")
    }


# ---------------------------------------------------------------------------
# Task 20 — DELETE /projects/{slug}/runs/{id}/results/{case_id}
# ---------------------------------------------------------------------------


@router.delete("/api/projects/{project_slug}/runs/{run_id}/results/{case_id}", status_code=204)
async def delete_result(
    project_slug: str,
    run_id: str,
    case_id: str,
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    run_case = await repo.get_run_case_by_wombat_id(run_id=run.id, wombat_id=case_id)
    if run_case is None:
        raise CaseNotInRunError()

    await repo.clear_result(run_id=run.id, run_case_id=run_case.id)

    await repo.append_event(
        run_id=run.id,
        event_type="result_updated",
        payload={"case_id": case_id, "status": "not_run"},
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Task 21 — POST /projects/{slug}/runs/{id}/results/{case_id}/evidence (upload)
# ---------------------------------------------------------------------------


@router.post(
    "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}/evidence",
    status_code=201,
)
async def upload_evidence(
    project_slug: str,
    run_id: str,
    case_id: str,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
    backend=Depends(get_evidence_backend),
):
    from wombat_api.config import get_config

    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    run_case = await repo.get_run_case_by_wombat_id(run_id=run.id, wombat_id=case_id)
    if run_case is None:
        raise CaseNotInRunError()

    # Ensure a result row exists (evidence belongs to a result)
    result = await repo.get_result(run_id=run.id, run_case_id=run_case.id)
    if result is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "no_result", "message": "Record a result before attaching evidence."},
        )

    cfg = get_config()
    max_bytes = cfg.evidence.max_file_mb * 1_048_576

    # Stream-read with size cap
    data = io.BytesIO()
    total = 0
    chunk_size = 65536
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "evidence_too_large",
                    "message": f"File exceeds {cfg.evidence.max_file_mb} MB limit.",
                },
            )
        data.write(chunk)

    data.seek(0)
    mime_type = file.content_type or "application/octet-stream"
    filename = file.filename or "upload"

    blob_id = await backend.put(
        data=data,
        mime_type=mime_type,
        filename=filename,
        project_id=str(project.id),
    )

    evidence_row = await repo.add_evidence(
        result_id=result.id,
        blob_id=blob_id,
        filename=filename,
        mime_type=mime_type,
        size_bytes=total,
        uploaded_by_user_id=principal.user.id,
        uploaded_by_token_id=principal.token.id if principal.token else None,
    )

    await repo.append_event(
        run_id=run.id,
        event_type="evidence_attached",
        payload={"case_id": case_id, "evidence_id": str(evidence_row.id), "filename": filename},
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    await session.refresh(evidence_row)

    actor_ref = ActorRef(principal_type="user", id=principal.user.id)
    return {
        "data": EvidenceOut(
            id=evidence_row.id,
            filename=evidence_row.filename,
            mime_type=evidence_row.mime_type,
            size_bytes=evidence_row.size_bytes,
            uploaded_by=actor_ref,
            uploaded_at=evidence_row.uploaded_at,
        ).model_dump(mode="json")
    }


# ---------------------------------------------------------------------------
# Task 21 — DELETE /projects/{slug}/runs/{id}/results/{case_id}/evidence/{eid}
# ---------------------------------------------------------------------------


@router.delete(
    "/api/projects/{project_slug}/runs/{run_id}/results/{case_id}/evidence/{evidence_id}",
    status_code=204,
)
async def delete_evidence(
    project_slug: str,
    run_id: str,
    case_id: str,
    evidence_id: str,
    authctx=Depends(require_permission(Permission.RUNS_RECORD)),
    session: AsyncSession = Depends(get_session),
    backend=Depends(get_evidence_backend),
):
    project, principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    await assert_run_actor_authorized(
        session,
        run=run,
        user_id=principal.user.id,
        token_id=principal.token.id if principal.token else None,
        is_admin=_role.value >= 3,
    )

    if run.status != "open":
        raise RunClosedError()

    try:
        eid = _uuid.UUID(evidence_id)
    except ValueError:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    evidence_row = await repo.get_evidence(eid)
    if evidence_row is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    # Delete from storage backend
    await backend.delete(evidence_row.blob_id)
    await repo.delete_evidence(eid)

    await repo.append_event(
        run_id=run.id,
        event_type="evidence_removed",
        payload={"case_id": case_id, "evidence_id": str(eid)},
        actor_user_id=principal.user.id,
        actor_token_id=principal.token.id if principal.token else None,
    )

    await session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Task 22 — GET /projects/{slug}/runs/{id}/events (run event log)
# ---------------------------------------------------------------------------


@router.get("/api/projects/{project_slug}/runs/{run_id}/events")
async def list_run_events(
    project_slug: str,
    run_id: str,
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
):
    project, _principal, _role = authctx
    repo = Repository(session)

    run = await _get_run_or_404(repo, project_id=project.id, run_id_str=run_id)

    events = await repo.list_events(run_id=run.id, limit=limit + 1, cursor=cursor)

    next_cursor: str | None = None
    if len(events) > limit:
        last = events[limit - 1]
        next_cursor = _encode_event_cursor(last.created_at, last.id)
        events = events[:limit]

    events_out = []
    for ev in events:
        actor: ActorRef | None = None
        if ev.actor_user_id:
            actor = ActorRef(principal_type="user", id=ev.actor_user_id)
        elif ev.actor_token_id:
            actor = ActorRef(principal_type="token", id=ev.actor_token_id)

        events_out.append(
            EventOut(
                id=ev.id,
                event_type=ev.event_type,
                actor=actor,
                payload=ev.payload or {},
                created_at=ev.created_at,
            ).model_dump(mode="json")
        )

    return {"events": events_out, "next_cursor": next_cursor}
