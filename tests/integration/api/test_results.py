"""Smoke tests for Task 20: results CRUD (batch POST, PUT If-Match, DELETE).

Tests the non-atomic batch POST semantics, If-Match revision, and DELETE.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Task 20: POST /projects/{slug}/runs/{id}/results (batch)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_post_returns_per_item_results(
    httpx_client: AsyncClient,
    users,
    run_with_3_cases,
):
    """Batch result ingestion returns per-item ok/error; unknown case_id → error."""
    editor_token = users["editor"]["token"]
    slug = run_with_3_cases.project_slug
    run_id = run_with_3_cases.id
    case_ids = run_with_3_cases.case_ids

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[
            {"case_id": case_ids[0], "status": "pass"},
            {"case_id": case_ids[1], "status": "fail", "failed_at_step": 2},
            {"case_id": "TC-UNKNOWN-99", "status": "pass"},
        ],
    )
    assert r.status_code == 200, r.text
    body = r.json()["results"]
    assert len(body) == 3

    # First two succeed
    assert body[0]["case_id"] == case_ids[0]
    assert body[0]["ok"] is True
    assert body[0]["revision"] == 1

    assert body[1]["case_id"] == case_ids[1]
    assert body[1]["ok"] is True
    assert body[1]["revision"] == 1

    # Third is unknown
    assert body[2]["case_id"] == "TC-UNKNOWN-99"
    assert body[2]["ok"] is False
    assert body[2]["error"]["code"] == "case_not_in_run"


@pytest.mark.asyncio
async def test_batch_post_partial_success(
    httpx_client: AsyncClient,
    users,
    run_with_3_cases,
):
    """Partial success: 2 out of 3 succeed; overall response is 200."""
    editor_token = users["editor"]["token"]
    slug = run_with_3_cases.project_slug
    run_id = run_with_3_cases.id
    case_ids = run_with_3_cases.case_ids

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[
            {"case_id": case_ids[0], "status": "pass"},
            {"case_id": "TC-BAD-1", "status": "fail"},
            {"case_id": case_ids[2], "status": "blocked"},
        ],
    )
    assert r.status_code == 200
    body = r.json()["results"]
    ok_count = sum(1 for item in body if item["ok"])
    fail_count = sum(1 for item in body if not item["ok"])
    assert ok_count == 2
    assert fail_count == 1


@pytest.mark.asyncio
async def test_batch_post_viewer_forbidden(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Viewer cannot record results (needs RUNS_RECORD)."""
    viewer_token = users["viewer"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_ids = run_with_1_case.case_ids

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {viewer_token}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Task 20: GET /projects/{slug}/runs/{id}/results (list)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_results_happy_path(
    httpx_client: AsyncClient,
    users,
    run_with_3_cases,
):
    """List results returns recorded results."""
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]
    slug = run_with_3_cases.project_slug
    run_id = run_with_3_cases.id
    case_ids = run_with_3_cases.case_ids

    # Record a result
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r.status_code == 200

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert len(data) >= 1
    assert any(d["case_id"] == case_ids[0] and d["status"] == "pass" for d in data)


# ---------------------------------------------------------------------------
# Task 20: PUT /projects/{slug}/runs/{id}/results/{case_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_result_happy_path(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """PUT result creates a result on a fresh run (no If-Match)."""
    editor_token = users["editor"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"status": "pass"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "pass"
    assert data["revision"] == 1


@pytest.mark.asyncio
async def test_put_result_if_match_conflict(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """PUT with wrong If-Match revision returns 409 result_conflict."""
    editor_token = users["editor"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    # First write (creates revision=1)
    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"status": "pass"},
    )
    assert r.status_code == 200

    # Second write with wrong If-Match (expects revision=99 but current is 1)
    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={
            "Authorization": f"Bearer {editor_token}",
            "If-Match": "99",
        },
        json={"status": "fail"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "result_conflict"
    assert r.json()["error"]["current_revision"] == 1


@pytest.mark.asyncio
async def test_put_result_if_match_correct(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """PUT with correct If-Match bumps revision to 2."""
    editor_token = users["editor"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"status": "pass"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["revision"] == 1

    # Now update with correct If-Match
    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={
            "Authorization": f"Bearer {editor_token}",
            "If-Match": "1",
        },
        json={"status": "fail", "notes": "Flaky"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["revision"] == 2
    assert data["status"] == "fail"


# ---------------------------------------------------------------------------
# Task 20: DELETE /projects/{slug}/runs/{id}/results/{case_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_result_clears_to_not_run(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """DELETE result removes the row; subsequent list shows not_run."""
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    # Record
    r = await httpx_client.put(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"status": "pass"},
    )
    assert r.status_code == 200

    # Delete (clear to not_run)
    r = await httpx_client.delete(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 204, r.text

    # Get run detail: should show not_run=1, pass=0
    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    counts = r.json()["data"]["counts"]
    assert counts["not_run"] == 1
    assert counts["pass_"] == 0 or counts.get("pass", 0) == 0
