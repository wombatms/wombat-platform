"""Smoke tests for Task 22: run events endpoint.

Tests that events reflect lifecycle actions (create, result, close, etc.).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Task 22: GET /projects/{slug}/runs/{id}/events
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_events_reflect_lifecycle(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Recording a result creates a result_recorded event visible in /events."""
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    # Record a result
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "pass"}],
    )
    assert r.status_code == 200

    # Fetch events
    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/events",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    evts = r.json()["events"]
    event_types = [e["event_type"] for e in evts]
    assert "result_recorded" in event_types


@pytest.mark.asyncio
async def test_events_on_run_creation(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """A freshly created run has run_created and case_added events."""
    admin_token = users["admin"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/events",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    evts = r.json()["events"]
    event_types = [e["event_type"] for e in evts]

    assert "run_created" in event_types
    assert "case_added" in event_types


@pytest.mark.asyncio
async def test_events_pagination(
    httpx_client: AsyncClient,
    users,
    run_with_3_cases,
):
    """Events endpoint supports cursor pagination."""
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]
    slug = run_with_3_cases.project_slug
    run_id = run_with_3_cases.id
    case_ids = run_with_3_cases.case_ids

    # Record results for all 3 cases to generate more events
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": cid, "status": "pass"} for cid in case_ids],
    )
    assert r.status_code == 200

    # Fetch with limit=2
    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/events?limit=2",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["events"]) == 2
    # May have a next_cursor if more than 2 events exist (run has run_created +
    # 3 case_added + 3 result_recorded = at least 7 events)
    # next_cursor should be set
    assert "next_cursor" in body


@pytest.mark.asyncio
async def test_events_unauth(
    httpx_client: AsyncClient,
    run_with_1_case,
):
    """Unauthenticated events request returns 401."""
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    r = await httpx_client.get(f"/api/projects/{slug}/runs/{run_id}/events")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_events_viewer_can_read(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Viewer role (RUNS_READ) can read events."""
    viewer_token = users["viewer"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/events",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 200, r.text
    assert "events" in r.json()


@pytest.mark.asyncio
async def test_events_close_run_emits_event(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Closing a run emits a run_closed event."""
    admin_token = users["admin"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/close",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"reason": "completed", "note": "Done"},
    )
    assert r.status_code == 200

    r = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}/events",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    event_types = [e["event_type"] for e in r.json()["events"]]
    assert "run_closed" in event_types
