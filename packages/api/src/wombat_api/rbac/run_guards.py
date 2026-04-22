"""Run-level ownership / assignee / admin gate (SP3.3)."""

from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.models import RunDB
from wombat_api.database.repository import Repository


async def assert_run_actor_authorized(
    session: AsyncSession,
    *,
    run: RunDB,
    user_id: uuid.UUID | None,
    token_id: uuid.UUID | None,
    is_admin: bool,
) -> None:
    """Raises 403 unless the actor is the run's owner, an assignee, or admin.

    The caller has already checked they hold the right ``runs:*`` permission;
    this guard enforces the *CI-account* boundary on top of that.
    """
    if is_admin:
        return
    if user_id is not None and run.owner_id == user_id:
        return
    repo = Repository(session)
    if await repo.is_principal_on_run(run_id=run.id, user_id=user_id, token_id=token_id):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={
            "code": "unauthorized_run_action",
            "message": (
                "You have the required permission but are not the owner, an assignee, or an admin on this run."
            ),
        },
    )
