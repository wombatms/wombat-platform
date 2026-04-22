"""Integration tests for GET /api/auth/me — runs:* permission surface.

These tests verify that the /me endpoint correctly surfaces per-project
permissions derived from the user's role, including the runs:* permissions
added in SP3.3 Task 8.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_me_includes_runs_permissions_for_editor(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Editor role must surface runs:read/create/record/close but NOT runs:reopen."""
    _project, slug = seeded_project
    editor_token = users["editor"]["token"]

    r = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 200
    body = r.json()

    perms = body["permissions_by_project"][slug]
    assert "runs:read" in perms
    assert "runs:create" in perms
    assert "runs:record" in perms
    assert "runs:close" in perms
    assert "runs:reopen" not in perms


@pytest.mark.asyncio
async def test_me_includes_runs_permissions_for_admin(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Admin role must surface all runs:* permissions including runs:reopen."""
    _project, slug = seeded_project
    admin_token = users["admin"]["token"]

    r = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200
    body = r.json()

    perms = body["permissions_by_project"][slug]
    assert "runs:read" in perms
    assert "runs:create" in perms
    assert "runs:record" in perms
    assert "runs:close" in perms
    assert "runs:reopen" in perms


@pytest.mark.asyncio
async def test_me_includes_runs_read_only_for_viewer(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Viewer role must surface only runs:read from the runs:* family."""
    _project, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 200
    body = r.json()

    perms = body["permissions_by_project"][slug]
    assert "runs:read" in perms
    assert "runs:create" not in perms
    assert "runs:record" not in perms
    assert "runs:close" not in perms
    assert "runs:reopen" not in perms
