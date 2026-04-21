"""Project-scoped RBAC dependency factory."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.dependencies import Principal, get_current_user, get_principal
from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB, UserDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission


def require_role(minimum_role: Role):
    """Return a FastAPI dependency that enforces a minimum role on a project.

    The dependency reads ``project_slug`` from the path, resolves the project,
    checks the caller's role, and returns the ``ProjectDB`` on success.

    Raises:
        HTTPException(404) — project not found.
        HTTPException(403, "No access") — caller has no role on the project.
        HTTPException(403, "Requires <role>") — caller's role is too low.
    """

    async def dependency(
        project_slug: str,
        user: UserDB = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> ProjectDB:
        repo = Repository(session)
        project = await repo.get_project(project_slug)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        role_str = await repo.get_user_role(user.id, project.id)
        if role_str is None:
            raise HTTPException(status_code=403, detail="No access")
        if Role[role_str] < minimum_role:
            raise HTTPException(status_code=403, detail=f"Requires {minimum_role.name}")
        return project

    return dependency


def require_permission(permission: Permission):
    """FastAPI dependency: enforce that the principal (via its project role
    plus any token grant) has the given permission on the project.

    Returns (project, principal, role).
    """

    async def dependency(
        project_slug: str,
        principal: Principal = Depends(get_principal),
        session: AsyncSession = Depends(get_session),
    ) -> tuple[ProjectDB, Principal, Role]:
        repo = Repository(session)
        project = await repo.get_project(project_slug)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        role_str = await repo.get_user_role(principal.user.id, project.id)
        if role_str is None:
            raise HTTPException(status_code=403, detail="No access")
        role = Role[role_str]
        if permission not in principal.permissions(role):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "direct_publish_not_permitted"
                    if permission == Permission.CONTENT_PUBLISH_DIRECT
                    else "not_permitted",
                    "message": f"Requires {permission.value}",
                },
            )
        return project, principal, role

    return dependency
