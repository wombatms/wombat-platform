"""Environments CRUD routes.

Three endpoints under /projects/{slug}/environments:
  GET    — any project member (RUNS_READ is sufficient)
  POST   — any project member (RUNS_READ or RUNS_CREATE)
  DELETE — admin role only; FK ON DELETE SET NULL handles existing runs
"""

from __future__ import annotations

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.middleware import require_permission, require_role
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission
from wombat_api.runs.schemas import EnvironmentCreate, EnvironmentOut

router = APIRouter()


def _env_out(env) -> dict:
    return EnvironmentOut(
        id=env.id,
        name=env.name,
        created_by=env.created_by_user_id,
        created_at=env.created_at,
    ).model_dump(mode="json")


# ---------------------------------------------------------------------------
# GET /projects/{project_slug}/environments
# ---------------------------------------------------------------------------


@router.get("/{project_slug}/environments")
async def list_environments(
    project_slug: str,
    project: ProjectDB = Depends(require_role(Role.viewer)),
    session: AsyncSession = Depends(get_session),
):
    """List all environments for the project. Any project member may call this."""
    repo = Repository(session)
    envs = await repo.list_environments(project.id)
    return {"data": [_env_out(e) for e in envs]}


# ---------------------------------------------------------------------------
# POST /projects/{project_slug}/environments
# ---------------------------------------------------------------------------


@router.post("/{project_slug}/environments", status_code=201)
async def create_environment(
    project_slug: str,
    body: EnvironmentCreate,
    authctx=Depends(require_permission(Permission.RUNS_READ)),
    session: AsyncSession = Depends(get_session),
):
    """Create a new environment. Any project member (viewer/editor/admin) may call this.

    RUNS_READ is held by all roles so this effectively allows any member to
    inline-create an environment when creating a run.  Duplicate names return 409.
    """
    project, principal, _role = authctx
    repo = Repository(session)
    try:
        env = await repo.create_environment(
            project_id=project.id,
            name=body.name,
            user_id=principal.user.id,
        )
        await session.commit()
        await session.refresh(env)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "environment_already_exists",
                "message": f"An environment named '{body.name}' already exists in this project.",
                "field": "name",
                "hint": None,
            },
        ) from exc
    return {"data": _env_out(env)}


# ---------------------------------------------------------------------------
# DELETE /projects/{project_slug}/environments/{env_id}
# ---------------------------------------------------------------------------


@router.delete("/{project_slug}/environments/{env_id}", status_code=204)
async def delete_environment(
    project_slug: str,
    env_id: str,
    project: ProjectDB = Depends(require_role(Role.admin)),
    session: AsyncSession = Depends(get_session),
):
    """Hard-delete an environment. Requires admin role.

    Existing runs that reference this environment have their environment_id
    set to NULL via the ON DELETE SET NULL foreign-key constraint.
    """
    repo = Repository(session)
    try:
        parsed_id = _uuid.UUID(env_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Environment not found") from exc

    await repo.delete_environment(parsed_id)
    await session.commit()
