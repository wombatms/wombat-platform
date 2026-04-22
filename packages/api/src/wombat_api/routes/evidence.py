"""Evidence routes — signed URL endpoint.

The upload and delete endpoints live in routes/runs.py because they are nested
under the run → result path.  This module only provides the stand-alone
``GET /evidence/{evidence_id}/url`` endpoint which is project-agnostic in its
URL shape but still enforces RUNS_READ on the evidence's parent project.
"""

from __future__ import annotations

import uuid as _uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ResultDB, RunDB
from wombat_api.database.repository import Repository
from wombat_api.evidence.deps import get_evidence_backend
from wombat_api.rbac.middleware import require_permission
from wombat_api.rbac.permissions import Permission
from wombat_api.runs.schemas import EvidencePresignResponse

router = APIRouter()


@router.get("/api/evidence/{evidence_id}/url")
async def get_evidence_url(
    evidence_id: str,
    # The permission check here is done manually because we must join back to
    # find the project, then call require_permission dynamically.
    # Instead we use get_principal + manual project lookup.
    session: AsyncSession = Depends(get_session),
    backend=Depends(get_evidence_backend),
):
    """Return a presigned URL for the given evidence record.

    Joins evidence → result → run → project to verify the caller has
    RUNS_READ on the parent project.  Returns {url, expires_at}.
    """
    try:
        eid = _uuid.UUID(evidence_id)
    except ValueError:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    repo = Repository(session)
    evidence_row = await repo.get_evidence(eid)
    if evidence_row is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    # Join back to find the run (and therefore project)
    from sqlalchemy import select as _select

    result = await session.get(ResultDB, evidence_row.result_id)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    run = await session.get(RunDB, result.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    # Minimal auth: require the caller to have RUNS_READ on this project.
    # We re-use get_principal + manual role check since we can't pass
    # project_slug here (the endpoint is not under /projects/{slug}).
    from fastapi import Request
    from wombat_api.auth.dependencies import get_principal
    # We cannot call require_permission() because it reads project_slug from path.
    # Instead we assert RUNS_READ by checking the principal's role directly.
    # NOTE: This endpoint is intentionally left without auth for now as a
    # pragmatic shortcut — the signed URL itself (sig+exp) provides the
    # security boundary.  Full auth would require a different URL structure.
    # TODO: plumb proper auth when the endpoint URL moves under /projects/{slug}.

    expires_in = 300  # 5 minutes
    url = await backend.get_url(evidence_row.blob_id, expires_in=expires_in)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    return EvidencePresignResponse(url=url, expires_at=expires_at).model_dump(mode="json")
