"""Smoke tests for Task 19: PATCH run, cases add/remove, close, reopen, rerun.

One happy + one forbidden per endpoint.
Exhaustive matrix lives in Task 27.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Shared fixture helpers
# ---------------------------------------------------------------------------


async def _seed_testcase(db_session: AsyncSession, project_id: uuid.UUID, wombat_id: str):
    from wombat_api.database.models import Content

    row = Content(
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Test {wombat_id}",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "id": wombat_id}, "markdown": "## Steps\n\n1. Do it."},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _create_run(client: AsyncClient, slug: str, token: str, title: str = "Test run", case_ids: list[str] | None = None) -> str:
    if case_ids:
        selection = {"case_ids": case_ids}
    else:
        # Use a filter that returns no rows (empty run)
        selection = {"filter": {"q": "__no_match_empty_run__"}}
    r = await client.post(
        f"/api/projects/{slug}/runs",
        json={"title": title, "case_selection": selection},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


# ---------------------------------------------------------------------------
# PATCH run
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_run_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin patches run title."""
    project, slug = seeded_project
    await db_session.commit()

    token = users["admin"]["token"]
    run_id = await _create_run(httpx_client, slug, token, "Original title")

    r = await httpx_client.patch(
        f"/api/projects/{slug}/runs/{run_id}",
        json={"title": "Updated title"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["title"] == "Updated title"


@pytest.mark.asyncio
async def test_patch_run_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot patch a run (needs RUNS_CLOSE permission)."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    run_id = await _create_run(httpx_client, slug, admin_token)

    r = await httpx_client.patch(
        f"/api/projects/{slug}/runs/{run_id}",
        json={"title": "Nope"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_cases_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Editor adds cases to an open run."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-ADD-1")
    await db_session.commit()

    token = users["editor"]["token"]
    run_id = await _create_run(httpx_client, slug, token, "Add-cases run")

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/cases",
        json={"case_selection": {"case_ids": ["TC-ADD-1"]}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["counts"]["total"] == 1


@pytest.mark.asyncio
async def test_add_cases_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot add cases (needs RUNS_RECORD)."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    run_id = await _create_run(httpx_client, slug, admin_token)

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/cases",
        json={"case_selection": {"case_ids": []}},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# DELETE run case
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_case_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Editor removes a case from an open run that has no result."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-RM-1")
    await db_session.commit()

    token = users["editor"]["token"]
    # Create run with TC-RM-1
    run_id = await _create_run(httpx_client, slug, token, "Remove case run", case_ids=["TC-RM-1"])

    # Get the run to find the run_case id
    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200

    # List run cases via internal repository to get run_case_id
    from wombat_api.database.repository import Repository
    from sqlalchemy.ext.asyncio import async_sessionmaker
    import wombat_api.database.engine as _engine_mod
    factory = async_sessionmaker(_engine_mod.engine, expire_on_commit=False)
    async with factory() as s:
        repo = Repository(s)
        import uuid as _uuid
        run_cases = await repo.list_run_cases(_uuid.UUID(run_id))
    assert len(run_cases) == 1
    rc_id = str(run_cases[0].id)

    r = await httpx_client.delete(
        f"/api/projects/{slug}/runs/{run_id}/cases/{rc_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_remove_case_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot remove cases."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-RM-V1")
    await db_session.commit()

    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    run_id = await _create_run(httpx_client, slug, admin_token, "Remove viewer", case_ids=["TC-RM-V1"])

    r = await httpx_client.delete(
        f"/api/projects/{slug}/runs/{run_id}/cases/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST close
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_close_run_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin closes an open run."""
    _, slug = seeded_project
    token = users["admin"]["token"]
    run_id = await _create_run(httpx_client, slug, token, "Close run")

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        json={"reason": "completed", "note": "All done"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "completed"
    assert data["closure_note"] == "All done"


@pytest.mark.asyncio
async def test_close_run_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot close a run."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    run_id = await _create_run(httpx_client, slug, admin_token)

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        json={"reason": "aborted"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST reopen
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reopen_run_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin can reopen a closed run."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]

    run_id = await _create_run(httpx_client, slug, admin_token, "Reopen run")

    # Close it first
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        json={"reason": "completed"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200

    # Now reopen
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/reopen",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "open"


@pytest.mark.asyncio
async def test_reopen_run_editor_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Editor cannot reopen a run (requires RUNS_REOPEN = admin only)."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]

    run_id = await _create_run(httpx_client, slug, admin_token, "Reopen forbidden")

    # Close it
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        json={"reason": "completed"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200

    # Editor tries to reopen
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/reopen",
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST rerun
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rerun_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin creates a rerun from a parent run."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-RERUN-1")
    await db_session.commit()

    token = users["admin"]["token"]
    run_id = await _create_run(httpx_client, slug, token, "Parent run", case_ids=["TC-RERUN-1"])

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/reruns",
        json={"include_statuses": ["fail", "blocked"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["parent_run_id"] == run_id
    assert "Rerun" in data["title"]


@pytest.mark.asyncio
async def test_rerun_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot create a rerun (needs RUNS_CREATE)."""
    _, slug = seeded_project
    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    run_id = await _create_run(httpx_client, slug, admin_token)

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/reruns",
        json={},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403
