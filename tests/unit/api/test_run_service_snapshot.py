"""Unit tests for RunService.create_run — snapshot-on-create guarantees.

Key invariant: once a run is created, the snapshot hash for each case is
frozen.  Editing the underlying Content row MUST NOT change the snapshot
stored for existing run cases.
"""

from __future__ import annotations

import pytest

from wombat_api.database.repository import Repository
from wombat_api.runs.schemas import CaseSelection
from wombat_api.runs.service import RunService


@pytest.mark.asyncio
async def test_snapshot_is_frozen_after_case_edit(
    db_session, sample_project, sample_user, two_testcases
):
    """Editing a Content row after run creation must not alter the snapshot hash."""
    svc = RunService(db_session)
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="R1",
        case_selection=CaseSelection(
            case_ids=[two_testcases[0].wombat_id, two_testcases[1].wombat_id]
        ),
    )

    # Record the hash of the first case's snapshot.
    repo = Repository(db_session)
    run_cases = await repo.list_run_cases(run.id)
    assert len(run_cases) == 2

    # Fetch the snapshot for the first run_case.
    rc0 = run_cases[0]
    from sqlalchemy import select
    from wombat_api.database.models import RunCaseSnapshotDB

    snap = (
        await db_session.execute(
            select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == rc0.snapshot_id)
        )
    ).scalar_one()
    original_hash = snap.content_hash

    # Edit the Content body directly.
    two_testcases[0].body = {
        "frontmatter": {"title": "X-EDITED"},
        "markdown": "new body",
    }
    await db_session.flush()

    # Re-load snapshot; hash must be unchanged.
    await db_session.refresh(snap)
    assert snap.content_hash == original_hash, (
        "Snapshot hash changed after Content edit — snapshot was not frozen."
    )


@pytest.mark.asyncio
async def test_create_run_returns_correct_case_count(
    db_session, sample_project, sample_user, two_testcases
):
    """create_run must insert exactly as many run_cases as selected."""
    svc = RunService(db_session)
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="R2",
        case_selection=CaseSelection(
            case_ids=[two_testcases[0].wombat_id, two_testcases[1].wombat_id]
        ),
    )

    repo = Repository(db_session)
    run_cases = await repo.list_run_cases(run.id)
    assert len(run_cases) == 2


@pytest.mark.asyncio
async def test_create_run_display_order_is_preserved(
    db_session, sample_project, sample_user, two_testcases
):
    """Run cases must be inserted in the order the caller requested them."""
    svc = RunService(db_session)
    # Pass TC-0002 first, TC-0001 second — order must be preserved.
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="R3",
        case_selection=CaseSelection(
            case_ids=[two_testcases[1].wombat_id, two_testcases[0].wombat_id]
        ),
    )

    repo = Repository(db_session)
    run_cases = await repo.list_run_cases(run.id)
    # list_run_cases returns ordered by display_order ASC.
    assert run_cases[0].display_order == 0
    assert run_cases[1].display_order == 1

    # Confirm snapshot wombat_ids match the requested order.
    from sqlalchemy import select
    from wombat_api.database.models import RunCaseSnapshotDB

    snap0 = (
        await db_session.execute(
            select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == run_cases[0].snapshot_id)
        )
    ).scalar_one()
    snap1 = (
        await db_session.execute(
            select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == run_cases[1].snapshot_id)
        )
    ).scalar_one()
    assert snap0.snapshot_wombat_id == two_testcases[1].wombat_id
    assert snap1.snapshot_wombat_id == two_testcases[0].wombat_id


@pytest.mark.asyncio
async def test_create_run_dedupes_identical_snapshots(
    db_session, sample_project, sample_user, two_testcases
):
    """Two runs with the same cases must share the same snapshot rows (content-hash dedup)."""
    svc = RunService(db_session)
    run1 = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="Run A",
        case_selection=CaseSelection(case_ids=[two_testcases[0].wombat_id]),
    )
    run2 = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="Run B",
        case_selection=CaseSelection(case_ids=[two_testcases[0].wombat_id]),
    )

    repo = Repository(db_session)
    cases1 = await repo.list_run_cases(run1.id)
    cases2 = await repo.list_run_cases(run2.id)
    assert cases1[0].snapshot_id == cases2[0].snapshot_id


@pytest.mark.asyncio
async def test_create_run_emits_run_created_and_case_added_events(
    db_session, sample_project, sample_user, two_testcases
):
    """create_run must emit one run_created event and one case_added per case."""
    svc = RunService(db_session)
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="Evt Test",
        case_selection=CaseSelection(
            case_ids=[two_testcases[0].wombat_id, two_testcases[1].wombat_id]
        ),
    )

    repo = Repository(db_session)
    events = await repo.list_events(run_id=run.id, limit=20)
    event_types = [e.event_type for e in events]

    assert "run_created" in event_types
    case_added_count = event_types.count("case_added")
    assert case_added_count == 2


@pytest.mark.asyncio
async def test_create_run_skips_unknown_wombat_ids(
    db_session, sample_project, sample_user, two_testcases
):
    """Unknown wombat_ids in case_ids must be silently skipped (not raise)."""
    svc = RunService(db_session)
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="R-partial",
        case_selection=CaseSelection(
            case_ids=[two_testcases[0].wombat_id, "TC-DOES-NOT-EXIST"]
        ),
    )

    repo = Repository(db_session)
    run_cases = await repo.list_run_cases(run.id)
    assert len(run_cases) == 1


@pytest.mark.asyncio
async def test_create_run_with_shared_step_inlining(
    db_session, sample_project, sample_user
):
    """Shared-step references in a testcase body must be inlined into the snapshot."""
    from wombat_api.database.models import Content

    # Create a shared step.
    ss = Content(
        project_id=sample_project.id,
        kind="shared_step",
        wombat_id="SS-0001",
        title="Login steps",
        tags=[],
        body={
            "frontmatter": {"id": "SS-0001", "title": "Login steps"},
            "steps": [{"number": 1, "action": "Open browser", "expected": "Browser opens"}],
        },
        source_repo="test-repo",
        source_path="shared-steps/login.md",
        source_revision="abc",
        content_hash="ss-hash-init",
    )
    db_session.add(ss)

    # Create a testcase that references the shared step.
    tc = Content(
        project_id=sample_project.id,
        kind="testcase",
        wombat_id="TC-SS-01",
        title="TC with shared step",
        tags=[],
        body={
            "frontmatter": {
                "id": "TC-SS-01",
                "title": "TC with shared step",
                "shared_steps": ["SS-0001"],
            },
            "markdown": "# Test body",
        },
        source_repo="test-repo",
        source_path="cases/with_ss.md",
        source_revision="abc",
        content_hash="tc-hash-init",
    )
    db_session.add(tc)
    await db_session.flush()

    svc = RunService(db_session)
    run = await svc.create_run(
        project_id=sample_project.id,
        owner_id=sample_user.id,
        title="Run with SS",
        case_selection=CaseSelection(case_ids=["TC-SS-01"]),
    )

    repo = Repository(db_session)
    run_cases = await repo.list_run_cases(run.id)
    assert len(run_cases) == 1

    from sqlalchemy import select
    from wombat_api.database.models import RunCaseSnapshotDB

    snap = (
        await db_session.execute(
            select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.id == run_cases[0].snapshot_id)
        )
    ).scalar_one()

    # Snapshot body should contain inlined_shared_steps.
    assert "inlined_shared_steps" in snap.snapshot_body
    inlined = snap.snapshot_body["inlined_shared_steps"]
    assert len(inlined) == 1
    assert inlined[0]["wombat_id"] == "SS-0001"
