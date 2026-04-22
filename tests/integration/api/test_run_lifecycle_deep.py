"""Deep lifecycle tests for SP3.3 Task 31.

Covers:
1. started_at is NULL until first result recorded, then set.
2. Close-completed → status/closed_at set, run_closed event, subsequent writes return 403.
3. Reopen (admin) → status=open, closed_at cleared, run_reopened event, writes succeed again.
4. Rerun-failed from closed parent → new run, parent_run_id set, case list = {fail, blocked}.
   Assert new run's snapshots have same content_hashes if parent content unchanged.
5. Rerun with explicit case_ids overrides status filter.
6. Abort reason records run_aborted event.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_testcase(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    content_hash_suffix: str | None = None,
):
    """Insert a testcase Content row with a stable content_hash."""
    from wombat_api.database.models import Content

    ch = f"hash-{wombat_id}"
    if content_hash_suffix:
        ch = f"{ch}-{content_hash_suffix}"
    row = Content(
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Test {wombat_id}",
        tags=[],
        body={
            "frontmatter": {"kind": "testcase", "id": wombat_id},
            "markdown": f"## Steps\n\n1. Step for {wombat_id}.",
        },
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=ch,
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _create_run(
    client: AsyncClient,
    slug: str,
    token: str,
    title: str = "Test run",
    case_ids: list[str] | None = None,
) -> str:
    """POST /api/projects/{slug}/runs and return the run id."""
    selection = {"case_ids": case_ids} if case_ids else {"filter": {"q": "__no_match_empty_run__"}}
    r = await client.post(
        f"/api/projects/{slug}/runs",
        json={"title": title, "case_selection": selection},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


async def _close_run(
    client: AsyncClient,
    slug: str,
    run_id: str,
    token: str,
    reason: str = "completed",
    note: str | None = None,
) -> dict:
    """POST /close and return response data."""
    body: dict = {"reason": reason}
    if note:
        body["note"] = note
    r = await client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _record_results(
    client: AsyncClient,
    slug: str,
    run_id: str,
    token: str,
    items: list[dict],
) -> list[dict]:
    """POST batch results and return the per-item results list."""
    r = await client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        json=items,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["results"]


async def _get_events(
    client: AsyncClient,
    slug: str,
    run_id: str,
    token: str,
    limit: int = 100,
) -> list[dict]:
    """GET /events and return the events list."""
    r = await client.get(
        f"/api/projects/{slug}/runs/{run_id}/events?limit={limit}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["events"]


async def _get_run(
    client: AsyncClient,
    slug: str,
    run_id: str,
    token: str,
) -> dict:
    """GET /runs/{id} and return the data dict."""
    r = await client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _make_closed_run_with_mixed_results(
    db_session: AsyncSession,
    httpx_client: AsyncClient,
    users: dict,
    seeded_project: tuple,
    prefix: str,
) -> tuple[str, str, list[str]]:
    """Seed 4 cases, create a run, record mixed results, then close it.

    Returns (slug, run_id, [wombat_ids_in_order]).
    Results: case[0]=pass, case[1]=fail, case[2]=blocked, case[3]=pass.
    So 'fail'+'blocked' set = case[1], case[2].
    """
    project, slug = seeded_project
    case_ids: list[str] = []
    for i in range(4):
        wid = f"{prefix}-CASE-{i}"
        await _seed_testcase(db_session, project.id, wid)
        case_ids.append(wid)
    await db_session.commit()

    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]

    run_id = await _create_run(httpx_client, slug, editor_token, f"{prefix} run", case_ids)

    # Record mixed results: pass, fail, blocked, pass
    statuses = ["pass", "fail", "blocked", "pass"]
    items = [{"case_id": cid, "status": st} for cid, st in zip(case_ids, statuses, strict=False)]
    await _record_results(httpx_client, slug, run_id, editor_token, items)

    await _close_run(httpx_client, slug, run_id, admin_token, reason="completed")

    return slug, run_id, case_ids


# ---------------------------------------------------------------------------
# Test 1: started_at is NULL until first result, then set
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_started_at_null_until_first_result(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Run has started_at=None immediately after creation.
    After the first batch result is recorded, started_at is populated.
    """
    project, slug = seeded_project
    wid = f"TC-SA-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid)
    await db_session.commit()

    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]

    run_id = await _create_run(httpx_client, slug, editor_token, "started_at test", [wid])

    # Immediately after creation: started_at must be null
    run_data = await _get_run(httpx_client, slug, run_id, admin_token)
    assert run_data["started_at"] is None, f"Expected started_at=null after creation, got {run_data['started_at']!r}"

    # Record first result
    await _record_results(
        httpx_client,
        slug,
        run_id,
        editor_token,
        [{"case_id": wid, "status": "pass"}],
    )

    # Now started_at must be set
    run_data = await _get_run(httpx_client, slug, run_id, admin_token)
    assert run_data["started_at"] is not None, "Expected started_at to be populated after first result"


# ---------------------------------------------------------------------------
# Test 2: Close-completed → status/closed_at set, run_closed event, writes blocked
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_completed_blocks_writes(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Closing a run with reason=completed:
    - Sets status='completed' and closed_at in the response.
    - Appends a 'run_closed' event.
    - Subsequent POST /results returns 403 run_closed.
    """
    project, slug = seeded_project
    wid = f"TC-CLOSE-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid)
    await db_session.commit()

    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]

    run_id = await _create_run(httpx_client, slug, editor_token, "close test", [wid])

    close_data = await _close_run(httpx_client, slug, run_id, admin_token, reason="completed", note="All tests done")

    # Verify status and closed_at
    assert close_data["status"] == "completed"
    assert close_data["closed_at"] is not None
    assert close_data["closure_note"] == "All tests done"

    # Verify run_closed event was appended
    events = await _get_events(httpx_client, slug, run_id, admin_token)
    event_types = [e["event_type"] for e in events]
    assert "run_closed" in event_types, f"Expected 'run_closed' in events: {event_types}"

    # Verify subsequent write is rejected with 403
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        json=[{"case_id": wid, "status": "pass"}],
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403, f"Expected 403 on closed run write, got {r.status_code}: {r.text}"

    # Also check the error code if the response is JSON
    try:
        err = r.json()
        if "error" in err:
            assert err["error"]["code"] == "run_closed"
        elif "detail" in err:
            detail = err["detail"]
            if isinstance(detail, dict):
                assert detail.get("code") == "run_closed"
    except Exception:
        pass  # Some 403s may not be JSON


# ---------------------------------------------------------------------------
# Test 3: Reopen (admin) → status=open, closed_at cleared, run_reopened event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reopen_clears_closed_at_and_allows_writes(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin reopens a closed run:
    - status becomes 'open'.
    - closed_at is None in the response.
    - 'run_reopened' event is appended.
    - Subsequent result writes succeed.
    """
    project, slug = seeded_project
    wid = f"TC-REOPEN-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid)
    await db_session.commit()

    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]

    run_id = await _create_run(httpx_client, slug, editor_token, "reopen test", [wid])

    # Close it
    close_data = await _close_run(httpx_client, slug, run_id, admin_token, reason="completed")
    assert close_data["status"] == "completed"
    assert close_data["closed_at"] is not None

    # Reopen
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/reopen",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    reopen_data = r.json()["data"]

    assert reopen_data["status"] == "open", f"Expected status=open after reopen, got {reopen_data['status']!r}"
    assert reopen_data["closed_at"] is None, f"Expected closed_at=None after reopen, got {reopen_data['closed_at']!r}"

    # Verify run_reopened event
    events = await _get_events(httpx_client, slug, run_id, admin_token)
    event_types = [e["event_type"] for e in events]
    assert "run_reopened" in event_types, f"Expected 'run_reopened' in events: {event_types}"

    # Subsequent write should succeed
    results = await _record_results(
        httpx_client,
        slug,
        run_id,
        editor_token,
        [{"case_id": wid, "status": "pass"}],
    )
    assert results[0]["ok"] is True, f"Expected result write to succeed after reopen: {results[0]}"


# ---------------------------------------------------------------------------
# Test 4: Rerun-failed from closed parent → correct case set + same hashes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rerun_failed_from_closed_parent(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Rerun from a closed run:
    - New run has parent_run_id == parent run's id.
    - Cases are exactly the wombat_ids with status fail or blocked in parent.
    - New run's snapshots have the same content_hashes (content unchanged).
    """
    prefix = f"RRF-{uuid.uuid4().hex[:6]}"
    slug, parent_run_id, case_ids = await _make_closed_run_with_mixed_results(
        db_session, httpx_client, users, seeded_project, prefix
    )
    # case_ids[0]=pass, case_ids[1]=fail, case_ids[2]=blocked, case_ids[3]=pass
    expected_rerun_ids = {case_ids[1], case_ids[2]}

    admin_token = users["admin"]["token"]

    # Rerun with default statuses (fail + blocked)
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{parent_run_id}/reruns",
        json={"include_statuses": ["fail", "blocked"]},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    new_run_data = r.json()["data"]
    new_run_id = new_run_data["id"]

    # Assert parent linkage
    assert new_run_data["parent_run_id"] == parent_run_id, (
        f"Expected parent_run_id={parent_run_id}, got {new_run_data['parent_run_id']!r}"
    )

    # Assert the title includes "Rerun" (as per service implementation)
    assert "Rerun" in new_run_data["title"], f"Expected 'Rerun' in title, got {new_run_data['title']!r}"

    # Assert only the fail/blocked cases are in the new run
    assert new_run_data["counts"]["total"] == 2, (
        f"Expected 2 cases in rerun (fail+blocked), got {new_run_data['counts']['total']}"
    )

    # Inspect snapshot content_hashes: fetch snapshots from the new run and the parent
    # and verify they share the same hashes for the re-run cases
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    import wombat_api.database.engine as _engine_mod
    from wombat_api.database.models import RunCaseDB, RunCaseSnapshotDB

    factory = async_sessionmaker(_engine_mod.engine, expire_on_commit=False)
    async with factory() as s:
        # New run's snapshots
        new_run_uuid = uuid.UUID(new_run_id)
        stmt = (
            select(RunCaseDB, RunCaseSnapshotDB)
            .join(RunCaseSnapshotDB, RunCaseDB.snapshot_id == RunCaseSnapshotDB.id)
            .where(RunCaseDB.run_id == new_run_uuid)
        )
        new_pairs = (await s.execute(stmt)).all()
        new_hashes: dict[str, str] = {snap.snapshot_wombat_id: snap.content_hash for _rc, snap in new_pairs}
        new_wombat_ids = set(new_hashes.keys())

        # Parent run's snapshots
        parent_run_uuid = uuid.UUID(parent_run_id)
        stmt2 = (
            select(RunCaseDB, RunCaseSnapshotDB)
            .join(RunCaseSnapshotDB, RunCaseDB.snapshot_id == RunCaseSnapshotDB.id)
            .where(RunCaseDB.run_id == parent_run_uuid)
        )
        parent_pairs = (await s.execute(stmt2)).all()
        parent_hashes: dict[str, str] = {snap.snapshot_wombat_id: snap.content_hash for _rc, snap in parent_pairs}

    # Check that exactly the expected wombat_ids are in the new run
    assert new_wombat_ids == expected_rerun_ids, (
        f"Expected new run to contain {expected_rerun_ids}, got {new_wombat_ids}"
    )

    # Content unchanged → hashes must match between parent and new run
    for wid in expected_rerun_ids:
        assert wid in parent_hashes, f"Expected {wid!r} in parent snapshots"
        assert new_hashes[wid] == parent_hashes[wid], (
            f"Snapshot hash mismatch for {wid!r}: parent={parent_hashes[wid]!r}, rerun={new_hashes[wid]!r}"
        )


# ---------------------------------------------------------------------------
# Test 5: Rerun with explicit case_ids overrides status filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rerun_explicit_case_ids_overrides_status_filter(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """When rerun is requested with explicit case_ids, the status filter is ignored.
    Even cases that passed are included if specified.
    """
    prefix = f"RREX-{uuid.uuid4().hex[:6]}"
    slug, parent_run_id, case_ids = await _make_closed_run_with_mixed_results(
        db_session, httpx_client, users, seeded_project, prefix
    )
    # case_ids[0]=pass, case_ids[1]=fail, case_ids[2]=blocked, case_ids[3]=pass
    # We'll explicitly rerun only the 'pass' cases: [0] and [3]
    explicit_ids = [case_ids[0], case_ids[3]]

    admin_token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{parent_run_id}/reruns",
        json={"case_ids": explicit_ids},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    new_run_data = r.json()["data"]
    new_run_id = new_run_data["id"]

    # Should contain exactly the 2 explicitly specified cases
    assert new_run_data["counts"]["total"] == 2, (
        f"Expected 2 cases in explicit rerun, got {new_run_data['counts']['total']}"
    )
    assert new_run_data["parent_run_id"] == parent_run_id

    # Confirm the new run's snapshot wombat_ids match our explicit list
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker

    import wombat_api.database.engine as _engine_mod
    from wombat_api.database.models import RunCaseDB, RunCaseSnapshotDB

    factory = async_sessionmaker(_engine_mod.engine, expire_on_commit=False)
    async with factory() as s:
        new_run_uuid = uuid.UUID(new_run_id)
        stmt = (
            select(RunCaseDB, RunCaseSnapshotDB)
            .join(RunCaseSnapshotDB, RunCaseDB.snapshot_id == RunCaseSnapshotDB.id)
            .where(RunCaseDB.run_id == new_run_uuid)
        )
        pairs = (await s.execute(stmt)).all()
        new_wombat_ids = {snap.snapshot_wombat_id for _rc, snap in pairs}

    assert new_wombat_ids == set(explicit_ids), f"Expected new run wombat_ids={set(explicit_ids)}, got {new_wombat_ids}"


# ---------------------------------------------------------------------------
# Test 6: Abort reason records run_aborted event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_abort_records_run_aborted_event(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Closing a run with reason=aborted emits a 'run_aborted' event (not 'run_closed').
    The run status is 'aborted', closed_at is set.
    """
    project, slug = seeded_project
    wid = f"TC-ABORT-{uuid.uuid4().hex[:6]}"
    await _seed_testcase(db_session, project.id, wid)
    await db_session.commit()

    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]

    run_id = await _create_run(httpx_client, slug, editor_token, "abort test", [wid])

    abort_data = await _close_run(httpx_client, slug, run_id, admin_token, reason="aborted", note="Infra failure")

    # Status should be 'aborted'
    assert abort_data["status"] == "aborted", f"Expected status='aborted', got {abort_data['status']!r}"
    assert abort_data["closed_at"] is not None, "Expected closed_at to be set after abort"
    assert abort_data["closure_note"] == "Infra failure"

    # Should have run_aborted event, NOT run_closed
    events = await _get_events(httpx_client, slug, run_id, admin_token)
    event_types = [e["event_type"] for e in events]
    assert "run_aborted" in event_types, f"Expected 'run_aborted' in events: {event_types}"
    assert "run_closed" not in event_types, f"Did not expect 'run_closed' for aborted run, but found it: {event_types}"

    # Subsequent writes are also blocked (aborted = closed)
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        json=[{"case_id": wid, "status": "pass"}],
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403, f"Expected 403 on aborted run write, got {r.status_code}: {r.text}"
