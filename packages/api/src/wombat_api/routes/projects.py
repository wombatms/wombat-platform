"""Project management routes.

Policy: any authenticated user can create a project (they become its admin).
This is simpler than a 'server admin' gate and sufficient for MVP — the first
user bootstraps their own project.  Member management routes enforce project-
scoped RBAC so non-members cannot read or modify a project.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.dependencies import get_current_user
from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB, UserDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role
from wombat_api.schemas.common import ProjectCreate

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper: project row → dict
# ---------------------------------------------------------------------------


def _project_out(p: ProjectDB) -> dict:
    return {
        "id": str(p.id),
        "slug": p.slug,
        "name": p.name,
        "org": p.org,
        "default_owner": p.default_owner,
        "taxonomy_components": p.taxonomy_components,
        "taxonomy_environments": p.taxonomy_environments,
        "git_url": p.git_url,
        "created_at": p.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Create project
# ---------------------------------------------------------------------------


@router.post("/", status_code=201)
async def create_project(
    body: ProjectCreate,
    user: UserDB = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Create a new project.

    Any authenticated user may create a project; they are automatically
    assigned the 'admin' role on the newly created project.
    """
    repo = Repository(session)
    existing = await repo.get_project(body.slug)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Project slug already exists")
    project = await repo.create_project(body)
    # Auto-assign creator as admin.
    await repo.set_user_role(user.id, project.id, Role.admin.name)
    # SP3.3: every project has a 'default' execution environment out of the box.
    await repo.ensure_default_environment(project_id=project.id, user_id=user.id)
    await session.commit()
    return {"data": _project_out(project)}


# ---------------------------------------------------------------------------
# List projects for current user
# ---------------------------------------------------------------------------


@router.get("/")
async def list_projects(
    user: UserDB = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """List all projects the authenticated user has any role on."""
    repo = Repository(session)
    projects = await repo.list_projects_for_user(user.id)
    return {"data": [_project_out(p) for p in projects]}


# ---------------------------------------------------------------------------
# Get / update project
# ---------------------------------------------------------------------------


@router.get("/{project_slug}")
async def get_project(
    project: ProjectDB = Depends(require_role(Role.viewer)),
):
    """Return project details (viewer+)."""
    return {"data": _project_out(project)}


@router.patch("/{project_slug}")
async def update_project(
    project_slug: str,
    body: dict,
    project: ProjectDB = Depends(require_role(Role.admin)),
    session: AsyncSession = Depends(get_session),
):
    """Update project metadata (admin only).

    Only fields present in the body are updated.  Slug is immutable.
    """
    allowed = {
        "name",
        "org",
        "default_owner",
        "taxonomy_components",
        "taxonomy_environments",
        # SP3.2: git_url is mutable so the Playwright setup (and operators) can
        # wire the publish remote through the API without a DB shell.
        "git_url",
    }
    for key, value in body.items():
        if key in allowed:
            setattr(project, key, value)
    await session.commit()
    return {"data": _project_out(project)}


# ---------------------------------------------------------------------------
# Member management
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/members")
async def list_members(
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """List members and their roles (viewer+)."""
    repo = Repository(session)
    members = await repo.list_project_members(project.id)
    return {
        "data": [
            {"user_id": str(u.id), "email": u.email, "display_name": u.display_name, "role": r} for u, r in members
        ]
    }


@router.put("/{project_slug}/members/{member_user_id}")
async def add_or_update_member(
    project_slug: str,
    member_user_id: uuid.UUID,
    body: dict,
    project: ProjectDB = Depends(require_role(Role.admin)),
    session: AsyncSession = Depends(get_session),
):
    """Add a member or update their role (admin only).

    Body: {"role": "viewer"|"editor"|"admin"}
    """
    role_str = body.get("role")
    if role_str not in {r.name for r in Role}:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid role '{role_str}'. Valid: viewer, editor, admin",
        )
    # Verify user exists.
    from wombat_api.database.models import UserDB as _UserDB

    target = await session.get(_UserDB, member_user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    repo = Repository(session)
    await repo.set_user_role(member_user_id, project.id, role_str)
    await session.commit()
    return {"data": {"user_id": str(member_user_id), "role": role_str}}


@router.delete("/{project_slug}/members/{member_user_id}", status_code=204)
async def remove_member(
    project_slug: str,
    member_user_id: uuid.UUID,
    project: ProjectDB = Depends(require_role(Role.admin)),
    session: AsyncSession = Depends(get_session),
):
    """Remove a member from a project (admin only)."""
    repo = Repository(session)
    await repo.remove_user_role(member_user_id, project.id)
    await session.commit()
