"""Repository tests for SP3.3 run-related helpers."""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

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


async def test_upsert_snapshot_dedupes_on_hash(
    db_session, sample_project, sample_user, sample_testcase
):
    repo = Repository(db_session)
    body1 = {"frontmatter": {"title": "X"}, "markdown": "body"}
    snap1 = await repo.upsert_run_case_snapshot(
        content=sample_testcase, resolved_body=body1, content_hash="hash-abc"
    )
    snap2 = await repo.upsert_run_case_snapshot(
        content=sample_testcase, resolved_body=body1, content_hash="hash-abc"
    )
    assert snap1.id == snap2.id


async def test_create_environment_unique_per_project(
    db_session, sample_project, sample_user
):
    repo = Repository(db_session)
    await repo.create_environment(
        project_id=sample_project.id, name="staging", user_id=sample_user.id
    )
    with pytest.raises(IntegrityError):
        await repo.create_environment(
            project_id=sample_project.id, name="staging", user_id=sample_user.id
        )
        await db_session.flush()
