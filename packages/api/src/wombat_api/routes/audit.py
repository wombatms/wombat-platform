"""Audit log route — read-only access to the project audit log.

Endpoint
--------
GET /{slug}/audit-log

Query parameters
----------------
entity_type : str | None
    Filter by entity type (e.g. ``testcase``, ``run``).
action : str | None
    Filter by action name (e.g. ``create``, ``update``, ``delete``).
limit : int (default 50, max 200)
    Number of entries to return.
offset : int (default 0)
    Pagination offset.

Requires the ``viewer`` role or above.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import AuditLogDB, ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()


@router.get("/{project_slug}/audit-log")
async def get_audit_log(
    project_slug: str,
    entity_type: str | None = Query(None, description="Filter by entity type."),
    action: str | None = Query(None, description="Filter by action."),
    limit: int = Query(50, ge=1, le=200, description="Max entries to return."),
    offset: int = Query(0, ge=0, description="Pagination offset."),
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return a paginated list of audit log entries for the project."""
    repo = Repository(session)
    entries = await repo.get_audit_log(
        project_id=project.id,
        filters={"entity_type": entity_type, "action": action},
        limit=limit,
        offset=offset,
    )
    return {
        "data": [_audit_out(e) for e in entries],
        "pagination": {
            "limit": limit,
            "offset": offset,
            "returned": len(entries),
        },
    }


def _audit_out(e: AuditLogDB) -> dict:
    return {
        "id": str(e.id),
        "project_id": str(e.project_id),
        "user_id": str(e.user_id) if e.user_id else None,
        "action": e.action,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "details": e.details,
        "interface": e.interface,
        "agent_type": e.agent_type,
        "created_at": e.created_at.isoformat(),
    }
