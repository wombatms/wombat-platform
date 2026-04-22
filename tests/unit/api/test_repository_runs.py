"""Repository tests for SP3.3 run-related helpers."""

from __future__ import annotations

from wombat_api.database.repository import Repository


async def test_ensure_default_environment_is_idempotent(
    db_session, sample_project, sample_user
):
    repo = Repository(db_session)
    env1 = await repo.ensure_default_environment(
        project_id=sample_project.id, user_id=sample_user.id
    )
    env2 = await repo.ensure_default_environment(
        project_id=sample_project.id, user_id=sample_user.id
    )
    assert env1.id == env2.id
    assert env2.name == "default"
