"""Smoke tests for Task 18: create run / list runs / get run.

Happy path + one unauth case per endpoint.
Depth tests (permission matrix, snapshot deduplication, etc.) live in Phase 4.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_testcase(db_session: AsyncSession, project_id: uuid.UUID, wombat_id: str = "TC-001"):
    """Insert a minimal Content/testcase row for selection during run creation."""
    from wombat_api.database.models import Content

    row = Content(
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Test Case {wombat_id}",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "id": wombat_id}, "markdown": "## Steps\n\n1. Do it."},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


# ---------------------------------------------------------------------------
# Task 18: POST /projects/{slug}/runs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_run_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin can create a run with explicit case_ids."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-001")
    await db_session.commit()

    token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={
            "title": "Smoke run",
            "case_selection": {"case_ids": ["TC-001"]},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["title"] == "Smoke run"
    assert data["status"] == "open"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_run_unauth(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Unauthenticated request returns 401."""
    _, slug = seeded_project
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "X", "case_selection": {"case_ids": []}},
    )
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Task 18: GET /projects/{slug}/runs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_runs_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """List runs returns the run we just created."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-L01")
    await db_session.commit()

    token = users["admin"]["token"]

    # Create a run first
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "List test run", "case_selection": {"case_ids": ["TC-L01"]}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "data" in body
    titles = [d["title"] for d in body["data"]]
    assert "List test run" in titles


@pytest.mark.asyncio
async def test_list_runs_unauth(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Unauthenticated list request returns 401."""
    _, slug = seeded_project
    r = await httpx_client.get(f"/api/projects/{slug}/runs")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Task 18: GET /projects/{slug}/runs/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_run_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Get run returns RunDetailOut with counts and assignees."""
    project, slug = seeded_project
    await _seed_testcase(db_session, project.id, "TC-G01")
    await db_session.commit()

    token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "Get test run", "case_selection": {"case_ids": ["TC-G01"]}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    run_id = r.json()["data"]["id"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["id"] == run_id
    assert data["title"] == "Get test run"
    assert "counts" in data
    assert data["counts"]["total"] == 1
    assert data["counts"]["not_run"] == 1
    assert "assignees" in data


@pytest.mark.asyncio
async def test_get_run_unauth(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Unauthenticated get request returns 401."""
    _, slug = seeded_project
    r = await httpx_client.get(f"/api/projects/{slug}/runs/{uuid.uuid4()}")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_run_not_found(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Getting a non-existent run returns 404."""
    _, slug = seeded_project
    token = users["admin"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "run_not_found"
