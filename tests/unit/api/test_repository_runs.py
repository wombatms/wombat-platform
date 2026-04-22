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


# ---------------------------------------------------------------------------
# Task 7: runs / run_cases / results / events
# ---------------------------------------------------------------------------


async def test_upsert_result_new_row_starts_at_revision_one(
    db_session, sample_run, sample_run_case, sample_user
):
    repo = Repository(db_session)
    result = await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=sample_run_case.id,
        status="pass",
        source="manual",
        recorded_by_user_id=sample_user.id,
    )
    assert result.revision == 1
    assert result.status == "pass"


async def test_upsert_result_bumps_revision_on_match(
    db_session, sample_run, sample_run_case, sample_user
):
    repo = Repository(db_session)
    first = await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=sample_run_case.id,
        status="pass",
        source="manual",
        recorded_by_user_id=sample_user.id,
    )
    second = await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=sample_run_case.id,
        status="fail",
        source="manual",
        recorded_by_user_id=sample_user.id,
        expected_revision=first.revision,
    )
    assert second.id == first.id
    assert second.revision == 2
    assert second.status == "fail"


async def test_upsert_result_mismatch_raises_conflict(
    db_session, sample_run, sample_run_case, sample_user
):
    from wombat_api.runs.exceptions import ResultConflictError

    repo = Repository(db_session)
    await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=sample_run_case.id,
        status="pass",
        source="manual",
        recorded_by_user_id=sample_user.id,
    )
    with pytest.raises(ResultConflictError) as exc_info:
        await repo.upsert_result(
            run_id=sample_run.id,
            run_case_id=sample_run_case.id,
            status="fail",
            source="manual",
            recorded_by_user_id=sample_user.id,
            expected_revision=99,
        )
    assert exc_info.value.current_revision == 1


async def test_is_principal_on_run_with_user_and_token(
    db_session, sample_project, sample_user, sample_token, sample_run
):
    repo = Repository(db_session)
    # Owner is a principal.
    assert await repo.is_principal_on_run(run_id=sample_run.id, user_id=sample_user.id)

    # Unrelated token is not.
    assert not await repo.is_principal_on_run(
        run_id=sample_run.id, token_id=sample_token.id
    )

    # After adding token as assignee, it becomes a principal.
    await repo.add_assignee(
        run_id=sample_run.id,
        token_id=sample_token.id,
        added_by_user_id=sample_user.id,
    )
    assert await repo.is_principal_on_run(
        run_id=sample_run.id, token_id=sample_token.id
    )

    # A second user that is neither owner nor assignee is not a principal.
    import uuid as _uuid

    from wombat_api.database.models import UserDB

    stranger = UserDB(
        id=_uuid.uuid4(),
        email="stranger@example.com",
        hashed_password="x",
        display_name="Stranger",
    )
    db_session.add(stranger)
    await db_session.flush()
    assert not await repo.is_principal_on_run(
        run_id=sample_run.id, user_id=stranger.id
    )


async def test_count_results_by_status_buckets_correctly(
    db_session, sample_run, sample_testcase, sample_user
):
    """Add 3 cases, record 1 pass + 1 fail, expect 1 not_run + 1 pass + 1 fail."""
    from wombat_api.database.models import RunCaseDB, RunCaseSnapshotDB

    repo = Repository(db_session)

    # Create three snapshots + run_cases under sample_run.
    run_cases: list[RunCaseDB] = []
    for i in range(3):
        snap = RunCaseSnapshotDB(
            content_hash=f"hh-{i}",
            content_id=sample_testcase.id,
            snapshot_body={"frontmatter": {"title": f"C{i}"}, "markdown": ""},
            snapshot_title=f"C{i}",
            snapshot_wombat_id=f"TC-{i:04d}",
        )
        db_session.add(snap)
        await db_session.flush()
        rc = RunCaseDB(
            run_id=sample_run.id,
            snapshot_id=snap.id,
            display_order=i,
            added_by_user_id=sample_user.id,
        )
        db_session.add(rc)
        await db_session.flush()
        run_cases.append(rc)

    await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=run_cases[0].id,
        status="pass",
        source="manual",
        recorded_by_user_id=sample_user.id,
    )
    await repo.upsert_result(
        run_id=sample_run.id,
        run_case_id=run_cases[1].id,
        status="fail",
        source="manual",
        recorded_by_user_id=sample_user.id,
    )

    counts = await repo.count_results_by_status(sample_run.id)
    assert counts["pass"] == 1
    assert counts["fail"] == 1
    assert counts["blocked"] == 0
    assert counts["skipped"] == 0
    # 3 total cases, 2 recorded → 1 not_run.
    assert counts["not_run"] == 1
