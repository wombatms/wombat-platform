"""Unit tests for RunService.record_result_batch + run lifecycle methods.

Covers:
  - Batch semantics (both succeed with revision=1)
  - Matching If-Match bumps revision to 2
  - Mismatched If-Match returns ok=False with result_conflict code
  - Recording to a closed run raises RunClosedError
  - First batch stamps started_at
  - close_run (completed) → status / closed_at / run_closed event
  - close_run (aborted) → status / run_aborted event
  - reopen_run from closed → status=open, closed_at cleared, run_reopened event
  - rerun_failed → new run has parent_run_id, cases = fail|blocked only
  - rerun with explicit case_ids overrides status filter
"""

from __future__ import annotations

import pytest

from wombat_api.database.models import RunDB
from wombat_api.database.repository import Repository
from wombat_api.runs.exceptions import RunClosedError, RunNotOpenError
from wombat_api.runs.schemas import CaseSelection, RecordResultItem
from wombat_api.runs.service import RunService

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_run_with_cases(
    svc: RunService,
    project_id,
    owner_id,
    two_testcases,
    title: str = "Test run",
) -> RunDB:
    return await svc.create_run(
        project_id=project_id,
        owner_id=owner_id,
        title=title,
        case_selection=CaseSelection(case_ids=[two_testcases[0].wombat_id, two_testcases[1].wombat_id]),
    )


# ---------------------------------------------------------------------------
# Task 15: batch record semantics
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_batch_both_succeed_revision_one(db_session, sample_project, sample_user, two_testcases):
    """Two items in a batch both get ok=True with revision=1 on first record."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    items = [
        RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass"),
        RecordResultItem(case_id=two_testcases[1].wombat_id, status="fail"),
    ]
    results = await svc.record_result_batch(
        run=run,
        items=items,
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    assert len(results) == 2
    assert results[0].ok is True
    assert results[0].revision == 1
    assert results[1].ok is True
    assert results[1].revision == 1


@pytest.mark.asyncio
async def test_record_batch_matching_if_match_bumps_revision(db_session, sample_project, sample_user, two_testcases):
    """Updating with a correct if_match_revision=1 returns revision=2."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # First record
    first = await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    assert first[0].revision == 1

    # Update with matching if_match
    second = await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(
                case_id=two_testcases[0].wombat_id,
                status="fail",
                if_match_revision=1,
            )
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    assert second[0].ok is True
    assert second[0].revision == 2


@pytest.mark.asyncio
async def test_record_batch_mismatched_if_match_returns_conflict(
    db_session, sample_project, sample_user, two_testcases
):
    """Mismatched if_match_revision → ok=False, code=result_conflict, does NOT bump."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # First record
    await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    # Now attempt with wrong revision
    bad = await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(
                case_id=two_testcases[0].wombat_id,
                status="fail",
                if_match_revision=99,
            )
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    assert bad[0].ok is False
    assert bad[0].error is not None
    assert bad[0].error["code"] == "result_conflict"
    assert bad[0].error["current_revision"] == 1


@pytest.mark.asyncio
async def test_record_batch_case_not_in_run_returns_error(db_session, sample_project, sample_user, two_testcases):
    """Recording a result for a case not in the run returns ok=False."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    results = await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id="TC-DOES-NOT-EXIST", status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    assert results[0].ok is False
    assert results[0].error is not None
    assert results[0].error["code"] == "case_not_in_run"


@pytest.mark.asyncio
async def test_record_batch_closed_run_raises_run_closed_error(db_session, sample_project, sample_user, two_testcases):
    """Recording to a closed run must raise RunClosedError at the service layer."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # Close the run.
    await svc.close_run(
        run=run,
        reason="completed",
        note=None,
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )

    with pytest.raises(RunClosedError):
        await svc.record_result_batch(
            run=run,
            items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
            actor_user_id=sample_user.id,
            actor_token_id=None,
            source="manual",
        )


@pytest.mark.asyncio
async def test_record_batch_first_result_stamps_started_at(db_session, sample_project, sample_user, two_testcases):
    """The first result batch on a run must set started_at."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    assert run.started_at is None

    await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    await db_session.refresh(run)
    assert run.started_at is not None


@pytest.mark.asyncio
async def test_record_batch_partial_success_does_not_block_good_items(
    db_session, sample_project, sample_user, two_testcases
):
    """A conflict on one item must NOT prevent the other items from succeeding."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # Record TC-0001 first so it has revision=1.
    await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    # Now send a batch: TC-0001 with wrong revision, TC-0002 fresh.
    results = await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(
                case_id=two_testcases[0].wombat_id,
                status="fail",
                if_match_revision=99,
            ),
            RecordResultItem(case_id=two_testcases[1].wombat_id, status="pass"),
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    # First item fails with conflict; second succeeds.
    assert results[0].ok is False
    assert results[1].ok is True
    assert results[1].revision == 1


@pytest.mark.asyncio
async def test_record_batch_emits_result_recorded_event(db_session, sample_project, sample_user, two_testcases):
    """result_recorded event must be appended for revision=1 results."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    event_types = [e.event_type for e in events]
    assert "result_recorded" in event_types


@pytest.mark.asyncio
async def test_record_batch_emits_result_updated_event(db_session, sample_project, sample_user, two_testcases):
    """result_updated event must be appended for revision > 1 updates."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    await svc.record_result_batch(
        run=run,
        items=[RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass")],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )
    await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(
                case_id=two_testcases[0].wombat_id,
                status="fail",
                if_match_revision=1,
            )
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    event_types = [e.event_type for e in events]
    assert "result_updated" in event_types


# ---------------------------------------------------------------------------
# Task 16: close / reopen / rerun
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_completed_sets_status_and_closed_at(db_session, sample_project, sample_user, two_testcases):
    """close_run(reason='completed') sets status=completed and stamps closed_at."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    closed = await svc.close_run(
        run=run,
        reason="completed",
        note="All good",
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )

    assert closed.status == "completed"
    assert closed.closed_at is not None


@pytest.mark.asyncio
async def test_close_completed_appends_run_closed_event(db_session, sample_project, sample_user, two_testcases):
    """close_run(reason='completed') must append a run_closed event."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    await svc.close_run(
        run=run,
        reason="completed",
        note=None,
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    assert "run_closed" in [e.event_type for e in events]


@pytest.mark.asyncio
async def test_close_aborted_sets_status_and_appends_run_aborted(
    db_session, sample_project, sample_user, two_testcases
):
    """close_run(reason='aborted') must set status=aborted and emit run_aborted."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    closed = await svc.close_run(
        run=run,
        reason="aborted",
        note="Aborted early",
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )

    assert closed.status == "aborted"
    assert closed.closed_at is not None

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    assert "run_aborted" in [e.event_type for e in events]


@pytest.mark.asyncio
async def test_reopen_clears_closed_at_and_emits_run_reopened(db_session, sample_project, sample_user, two_testcases):
    """reopen_run must reset status, clear closed_at, append run_reopened event."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    await svc.close_run(
        run=run,
        reason="completed",
        note=None,
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )
    assert run.status == "completed"
    assert run.closed_at is not None

    reopened = await svc.reopen_run(
        run=run,
        actor_user_id=sample_user.id,
        actor_token_id=None,
    )

    assert reopened.status == "open"
    assert reopened.closed_at is None

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    assert "run_reopened" in [e.event_type for e in events]


@pytest.mark.asyncio
async def test_reopen_already_open_run_raises_run_not_open_error(
    db_session, sample_project, sample_user, two_testcases
):
    """Trying to reopen an already-open run must raise RunNotOpenError."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    with pytest.raises(RunNotOpenError):
        await svc.reopen_run(
            run=run,
            actor_user_id=sample_user.id,
            actor_token_id=None,
        )


@pytest.mark.asyncio
async def test_rerun_failed_creates_new_run_with_parent_id(db_session, sample_project, sample_user, two_testcases):
    """rerun_failed must set parent_run_id on the new run."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # Record one fail and one pass.
    await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(case_id=two_testcases[0].wombat_id, status="fail"),
            RecordResultItem(case_id=two_testcases[1].wombat_id, status="pass"),
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    new_run = await svc.rerun_failed(
        parent_run=run,
        owner_id=sample_user.id,
    )

    assert new_run.parent_run_id == run.id
    assert new_run.id != run.id


@pytest.mark.asyncio
async def test_rerun_failed_includes_only_fail_and_blocked(db_session, sample_project, sample_user, two_testcases):
    """rerun_failed must include only cases with fail or blocked status."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # Record fail for TC[0], pass for TC[1].
    await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(case_id=two_testcases[0].wombat_id, status="fail"),
            RecordResultItem(case_id=two_testcases[1].wombat_id, status="pass"),
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    new_run = await svc.rerun_failed(
        parent_run=run,
        owner_id=sample_user.id,
    )

    repo = Repository(db_session)
    new_cases = await repo.list_run_cases(new_run.id)
    # Only the fail case should be in the rerun.
    assert len(new_cases) == 1

    from sqlalchemy import select

    from wombat_api.database.models import RunCaseSnapshotDB

    snap = (
        await db_session.execute(select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == new_cases[0].snapshot_id))
    ).scalar_one()
    assert snap.snapshot_wombat_id == two_testcases[0].wombat_id


@pytest.mark.asyncio
async def test_rerun_with_explicit_case_ids_overrides_status_filter(
    db_session, sample_project, sample_user, two_testcases
):
    """Passing case_ids to rerun must use those IDs, ignoring result statuses."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # Record pass for both.
    await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass"),
            RecordResultItem(case_id=two_testcases[1].wombat_id, status="pass"),
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    # Explicitly request to rerun only TC[1] even though its status is "pass".
    new_run = await svc.rerun(
        parent_run=run,
        owner_id=sample_user.id,
        case_ids=[two_testcases[1].wombat_id],
    )

    repo = Repository(db_session)
    new_cases = await repo.list_run_cases(new_run.id)
    assert len(new_cases) == 1

    from sqlalchemy import select

    from wombat_api.database.models import RunCaseSnapshotDB

    snap = (
        await db_session.execute(select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == new_cases[0].snapshot_id))
    ).scalar_one()
    assert snap.snapshot_wombat_id == two_testcases[1].wombat_id


@pytest.mark.asyncio
async def test_rerun_failed_with_no_failed_cases_creates_empty_run(
    db_session, sample_project, sample_user, two_testcases
):
    """rerun_failed when no cases failed creates a run with zero cases."""
    svc = RunService(db_session)
    run = await _create_run_with_cases(svc, sample_project.id, sample_user.id, two_testcases)

    # All pass.
    await svc.record_result_batch(
        run=run,
        items=[
            RecordResultItem(case_id=two_testcases[0].wombat_id, status="pass"),
            RecordResultItem(case_id=two_testcases[1].wombat_id, status="pass"),
        ],
        actor_user_id=sample_user.id,
        actor_token_id=None,
        source="manual",
    )

    new_run = await svc.rerun_failed(parent_run=run, owner_id=sample_user.id)

    repo = Repository(db_session)
    new_cases = await repo.list_run_cases(new_run.id)
    assert len(new_cases) == 0
    assert new_run.parent_run_id == run.id
