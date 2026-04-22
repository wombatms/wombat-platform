"""Task 30: Snapshot dedupe + frozen-across-edits.

Three properties verified:

1. Two runs referencing the same testcase share one ``run_case_snapshots`` row
   (same ``content_hash``; exactly one row with that hash).
2. Editing the testcase body produces a new snapshot row for run-3; runs 1 & 2
   still point at the old row.
3. Shared-step inline expansion: a testcase body that references a shared_step
   has the shared-step body inlined into its snapshot.  Editing the shared_step
   afterwards does NOT change the already-frozen snapshot hash.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_testcase(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    markdown: str = "## Steps\n\n1. Do it.",
    shared_steps: list[str] | None = None,
) -> None:
    """Insert or update a testcase Content row directly."""
    from wombat_api.database.models import Content

    frontmatter: dict = {"kind": "testcase", "id": wombat_id}
    if shared_steps:
        frontmatter["shared_steps"] = shared_steps

    row = Content(
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Test {wombat_id}",
        tags=[],
        body={"frontmatter": frontmatter, "markdown": markdown},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"chash-{wombat_id}-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(row)
    await db_session.flush()


async def _update_testcase_body(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    new_markdown: str,
) -> None:
    """Update the markdown in an existing testcase body in-place."""
    from sqlalchemy import update
    from wombat_api.database.models import Content

    existing_q = select(Content).where(
        Content.project_id == project_id,
        Content.kind == "testcase",
        Content.wombat_id == wombat_id,
    )
    row = (await db_session.execute(existing_q)).scalar_one()
    new_body = dict(row.body)
    new_body["markdown"] = new_markdown
    # SQLAlchemy detects the column change via the mapped attribute.
    row.body = new_body  # type: ignore[assignment]
    row.content_hash = f"chash-{wombat_id}-{uuid.uuid4().hex[:8]}"
    await db_session.flush()


async def _seed_shared_step(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    steps: list[str],
) -> None:
    """Insert a shared_step Content row."""
    from wombat_api.database.models import Content

    row = Content(
        project_id=project_id,
        kind="shared_step",
        wombat_id=wombat_id,
        title=f"Shared Step {wombat_id}",
        tags=[],
        body={"frontmatter": {"kind": "shared_step", "id": wombat_id}, "steps": steps},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"sshash-{wombat_id}-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(row)
    await db_session.flush()


async def _update_shared_step_body(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    new_steps: list[str],
) -> None:
    """Update the steps list of a shared_step row in-place."""
    from wombat_api.database.models import Content

    q = select(Content).where(
        Content.project_id == project_id,
        Content.kind == "shared_step",
        Content.wombat_id == wombat_id,
    )
    row = (await db_session.execute(q)).scalar_one()
    new_body = dict(row.body)
    new_body["steps"] = new_steps
    row.body = new_body  # type: ignore[assignment]
    row.content_hash = f"sshash-{wombat_id}-{uuid.uuid4().hex[:8]}"
    await db_session.flush()


async def _create_run_for(
    client: AsyncClient,
    slug: str,
    token: str,
    case_ids: list[str],
    title: str = "Snapshot test run",
) -> str:
    r = await client.post(
        f"/api/projects/{slug}/runs",
        json={"title": title, "case_selection": {"case_ids": case_ids}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _snapshot_hash_for_run(
    db_session: AsyncSession,
    run_id_str: str,
) -> str:
    """Return the content_hash of the (first) snapshot attached to this run."""
    from wombat_api.database.models import RunCaseDB, RunCaseSnapshotDB

    run_id = uuid.UUID(run_id_str)
    q = (
        select(RunCaseSnapshotDB.content_hash)
        .join(RunCaseDB, RunCaseDB.snapshot_id == RunCaseSnapshotDB.id)
        .where(RunCaseDB.run_id == run_id)
        .limit(1)
    )
    result = await db_session.execute(q)
    row = result.scalar_one()
    return row


async def _count_snapshots_by_hash(db_session: AsyncSession, content_hash: str) -> int:
    """COUNT(*) from run_case_snapshots where content_hash = :h."""
    from wombat_api.database.models import RunCaseSnapshotDB

    q = select(func.count()).where(RunCaseSnapshotDB.content_hash == content_hash)
    result = await db_session.execute(q)
    return result.scalar_one()


# ---------------------------------------------------------------------------
# Test 1: Two runs → same snapshot row
# ---------------------------------------------------------------------------


async def test_two_runs_share_one_snapshot(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Two runs referencing the same (unchanged) testcase share one snapshot row.

    Assertions:
    - Both runs resolve to the same ``content_hash``.
    - Exactly one row in ``run_case_snapshots`` with that hash.
    """
    project, slug = seeded_project
    wid = f"TC-SNAP-DEDUP-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid)
    await db_session.commit()

    token = users["editor"]["token"]

    run1_id = await _create_run_for(httpx_client, slug, token, [wid], "Dedup run 1")
    run2_id = await _create_run_for(httpx_client, slug, token, [wid], "Dedup run 2")

    # Refresh session so we see the rows committed by the service layer.
    await db_session.rollback()

    hash1 = await _snapshot_hash_for_run(db_session, run1_id)
    hash2 = await _snapshot_hash_for_run(db_session, run2_id)

    assert hash1 == hash2, "Both runs must reference the same snapshot (same body → same hash)"

    count = await _count_snapshots_by_hash(db_session, hash1)
    assert count == 1, f"Expected exactly 1 run_case_snapshots row with hash {hash1!r}; got {count}"


# ---------------------------------------------------------------------------
# Test 2: Edit testcase → new snapshot; old runs still frozen on old snapshot
# ---------------------------------------------------------------------------


async def test_edit_testcase_creates_new_snapshot_old_runs_frozen(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """After editing the testcase body, a third run gets a NEW snapshot.

    The first two runs still point at the old snapshot row.
    """
    project, slug = seeded_project
    wid = f"TC-SNAP-FROZEN-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid, markdown="## Steps\n\n1. Original step.")
    await db_session.commit()

    token = users["editor"]["token"]

    run1_id = await _create_run_for(httpx_client, slug, token, [wid], "Frozen run 1")
    run2_id = await _create_run_for(httpx_client, slug, token, [wid], "Frozen run 2")

    # Refresh to read committed state.
    await db_session.rollback()

    hash_before = await _snapshot_hash_for_run(db_session, run1_id)

    # Now edit the testcase body.
    await _update_testcase_body(db_session, project.id, wid, "## Steps\n\n1. EDITED step.")
    await db_session.commit()

    run3_id = await _create_run_for(httpx_client, slug, token, [wid], "Run after edit")

    await db_session.rollback()

    hash_run1 = await _snapshot_hash_for_run(db_session, run1_id)
    hash_run2 = await _snapshot_hash_for_run(db_session, run2_id)
    hash_run3 = await _snapshot_hash_for_run(db_session, run3_id)

    # Run 3 must have a different hash (new content).
    assert hash_run3 != hash_before, "Run 3 should get a new snapshot after testcase edit"

    # Runs 1 and 2 must still point to the OLD snapshot.
    assert hash_run1 == hash_before, "Run 1 snapshot must be frozen (unchanged)"
    assert hash_run2 == hash_before, "Run 2 snapshot must be frozen (unchanged)"

    # There must be exactly one row for the OLD hash (runs 1 & 2 share it).
    old_count = await _count_snapshots_by_hash(db_session, hash_before)
    assert old_count == 1, f"Expected exactly 1 old snapshot row; got {old_count}"

    # There must be exactly one row for the NEW hash (only run 3).
    new_count = await _count_snapshots_by_hash(db_session, hash_run3)
    assert new_count == 1, f"Expected exactly 1 new snapshot row; got {new_count}"


# ---------------------------------------------------------------------------
# Test 3: Shared-step inlining is frozen at snapshot time
# ---------------------------------------------------------------------------


async def test_shared_step_inlined_and_frozen(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """A testcase referencing a shared_step has the step inlined in the snapshot.

    After editing the shared_step, the existing snapshot hash must be unchanged
    (the snapshot body still reflects the old shared-step content).
    """
    project, slug = seeded_project
    ss_id = f"SS-INLINE-{uuid.uuid4().hex[:6]}"
    tc_id = f"TC-INLINE-{uuid.uuid4().hex[:6]}"

    await _seed_shared_step(db_session, project.id, ss_id, ["Login", "Navigate to page"])
    await _seed_testcase(
        db_session,
        project.id,
        tc_id,
        markdown="## Steps\n\n1. Use shared step.",
        shared_steps=[ss_id],
    )
    await db_session.commit()

    token = users["editor"]["token"]

    run1_id = await _create_run_for(httpx_client, slug, token, [tc_id], "Inline run 1")

    await db_session.rollback()

    hash_before_edit = await _snapshot_hash_for_run(db_session, run1_id)

    # Confirm that the snapshot body contains inlined shared steps.
    from wombat_api.database.models import RunCaseDB, RunCaseSnapshotDB

    run1_uuid = uuid.UUID(run1_id)
    snap_q = (
        select(RunCaseSnapshotDB)
        .join(RunCaseDB, RunCaseDB.snapshot_id == RunCaseSnapshotDB.id)
        .where(RunCaseDB.run_id == run1_uuid)
        .limit(1)
    )
    snap_row = (await db_session.execute(snap_q)).scalar_one()
    snap_body = snap_row.snapshot_body

    assert "inlined_shared_steps" in snap_body, (
        "Snapshot body must contain 'inlined_shared_steps' key when testcase references a shared_step"
    )
    inlined = snap_body["inlined_shared_steps"]
    assert len(inlined) == 1
    assert inlined[0]["wombat_id"] == ss_id
    # The original steps must be present in the inlined body.
    assert "Login" in str(inlined[0]["body"])

    # Now edit the shared_step.
    await _update_shared_step_body(db_session, project.id, ss_id, ["Login", "Navigate to NEW page"])
    await db_session.commit()

    # Create run 2 — it should get a NEW snapshot (different inlined content).
    run2_id = await _create_run_for(httpx_client, slug, token, [tc_id], "Inline run 2 (after SS edit)")

    await db_session.rollback()

    hash_run1_after = await _snapshot_hash_for_run(db_session, run1_id)
    hash_run2 = await _snapshot_hash_for_run(db_session, run2_id)

    # Run 1's snapshot hash must be unchanged (frozen).
    assert hash_run1_after == hash_before_edit, (
        "Run 1 snapshot must remain frozen after shared_step edit"
    )

    # Run 2 must get a new snapshot (because the shared step body changed).
    assert hash_run2 != hash_before_edit, (
        "Run 2 must capture the edited shared_step content → different hash"
    )

    # Confirm run 1's inlined body still contains the OLD step text.
    old_snap_row = (await db_session.execute(snap_q)).scalar_one()
    old_inlined = old_snap_row.snapshot_body["inlined_shared_steps"]
    assert "Navigate to page" in str(old_inlined[0]["body"]), (
        "Run 1 snapshot body must still contain old shared-step content"
    )
    assert "Navigate to NEW page" not in str(old_inlined[0]["body"]), (
        "Run 1 snapshot body must NOT reflect the edited shared-step"
    )
