"""Integration tests: project-scoped API token issuance with runs:* permissions (SP3.3).

Covers:
- Editor can issue a token with their full default runs:* subset
- Editor cannot grant runs:reopen (admin-only)
- Editor cannot grant a permission they don't hold (e.g. content:publish_direct)
- Admin can grant runs:reopen
- Admin can grant content:publish_direct (with purpose)
- Default permissions (no permissions key) produces role-default runs:* set
- Invalid permission name returns 422
- Non-member returns 403
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_editor_issues_token_with_runs_record(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Editor can issue a token with the full runs:read/create/record/close subset."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={
            "name": "ci-bot",
            "permissions": ["runs:read", "runs:create", "runs:record", "runs:close"],
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert set(body["permissions"]) == {"runs:read", "runs:create", "runs:record", "runs:close"}
    assert body["raw_token"].startswith("wombat_")


@pytest.mark.asyncio
async def test_editor_cannot_grant_runs_reopen(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Editor cannot grant runs:reopen — that permission requires an admin issuer."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": "bot", "permissions": ["runs:reopen"]},
    )
    assert r.status_code == 403, r.text
    error = r.json().get("error", {})
    assert error.get("code") == "admin_required_for_permission"


@pytest.mark.asyncio
async def test_editor_cannot_grant_publish_direct(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Editor cannot grant content:publish_direct via the permissions list."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": "bot", "permissions": ["content:publish_direct"]},
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_viewer_cannot_grant_runs_create(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Viewer only holds runs:read; attempting to grant runs:create is refused."""
    project, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {viewer_token}"},
        json={"name": "bot", "permissions": ["runs:create"]},
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_admin_issues_token_with_runs_reopen(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Admin can grant runs:reopen on a token."""
    project, slug = seeded_project
    admin_token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "reopen-bot", "permissions": ["runs:reopen", "runs:read"]},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "runs:reopen" in body["permissions"]


@pytest.mark.asyncio
async def test_admin_issues_token_with_publish_direct(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Admin can issue a token with publish_direct=true (requires non-empty purpose)."""
    project, slug = seeded_project
    admin_token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": "publisher-bot",
            "publish_direct": True,
            "purpose": "automated release pipeline",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["publish_direct"] is True
    assert body["purpose"] == "automated release pipeline"


@pytest.mark.asyncio
async def test_default_permissions_uses_role_runs_subset(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Omitting permissions defaults to the caller's role-default runs:* subset."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": "default-perms-bot"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # Editor's role-default runs:* includes read/create/record/close but NOT reopen.
    perms = set(body["permissions"])
    assert "runs:read" in perms
    assert "runs:create" in perms
    assert "runs:record" in perms
    assert "runs:close" in perms
    assert "runs:reopen" not in perms


@pytest.mark.asyncio
async def test_viewer_default_permissions_is_runs_read_only(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """Viewer's default token permissions contains only runs:read."""
    project, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {viewer_token}"},
        json={"name": "readonly-bot"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    perms = set(body["permissions"])
    assert perms == {"runs:read"}


@pytest.mark.asyncio
async def test_invalid_permission_name_returns_422(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """An unknown permission string returns 422."""
    project, slug = seeded_project
    admin_token = users["admin"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "bad-bot", "permissions": ["runs:nonexistent"]},
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_non_member_cannot_issue_token(
    httpx_client: AsyncClient,
    users,
    db_session,
):
    """A user with no role on the project receives 403."""
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import ProjectDB, UserDB

    import uuid

    # Create a separate project that the `users` fixture users don't belong to.
    orphan_project = ProjectDB(
        slug=f"orphan-{uuid.uuid4().hex[:8]}",
        name="Orphan",
        org="test",
    )
    db_session.add(orphan_project)
    await db_session.flush()

    # Create a fresh user with no role on orphan_project.
    outsider = UserDB(
        email=f"outsider-{uuid.uuid4().hex[:6]}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Outsider",
        is_active=True,
    )
    db_session.add(outsider)
    await db_session.flush()
    await db_session.commit()

    outsider_token = create_access_token(outsider.id, outsider.email)

    r = await httpx_client.post(
        f"/api/projects/{orphan_project.slug}/tokens",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"name": "unauthorized-bot"},
    )
    assert r.status_code == 403, r.text
