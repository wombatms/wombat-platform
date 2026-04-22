"""Integration tests for the environments CRUD routes.

Tests cover:
- GET /projects/{slug}/environments (list) — any member (viewer OK)
- POST /projects/{slug}/environments (create) — any member; 201 on success
- 409 on duplicate name
- 403/404 for non-members
- DELETE /projects/{slug}/environments/{env_id} — admin only; 204 on success
- DELETE as non-admin returns 403
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_project_with_users(db_session: AsyncSession, users: dict):
    """Create a fresh project and grant all three roles to the users fixture members."""
    from wombat_api.database.models import ProjectDB, UserProjectRoleDB

    slug = f"env-test-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Env Test Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project)
    await db_session.flush()

    for role_name in ("viewer", "editor", "admin"):
        user = users[role_name]["user"]
        db_session.add(UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name))

    await db_session.commit()
    return project, slug


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_and_list_environment(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """POST creates an environment; GET lists it back."""
    project, slug = await _make_project_with_users(db_session, users)
    editor_token = users["editor"]["token"]

    # Create
    r = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": "staging"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert data["name"] == "staging"
    assert "id" in data
    assert "created_at" in data

    # List
    r = await httpx_client.get(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 200, r.text
    names = [e["name"] for e in r.json()["data"]]
    assert "staging" in names


@pytest.mark.asyncio
async def test_viewer_can_list_environments(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """A viewer (lowest role) can list environments."""
    project, slug = await _make_project_with_users(db_session, users)
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 200, r.text
    assert "data" in r.json()


@pytest.mark.asyncio
async def test_viewer_can_create_environment(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Any project member, including viewer, can create an environment
    (they hold RUNS_READ which is sufficient for inline-create).
    """
    project, slug = await _make_project_with_users(db_session, users)
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {viewer_token}"},
        json={"name": f"viewer-env-{uuid.uuid4().hex[:6]}"},
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_duplicate_name_returns_409(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Creating an environment with a duplicate name returns 409 environment_already_exists."""
    project, slug = await _make_project_with_users(db_session, users)
    editor_token = users["editor"]["token"]
    name = f"prod-{uuid.uuid4().hex[:6]}"

    r1 = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": name},
    )
    assert r1.status_code == 201, r1.text

    r2 = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {editor_token}"},
        json={"name": name},
    )
    assert r2.status_code == 409, r2.text
    error = r2.json()["error"]
    assert error["code"] == "environment_already_exists"


@pytest.mark.asyncio
async def test_non_member_gets_403_on_list(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """A user with no role on the project cannot list environments."""
    project, slug = await _make_project_with_users(db_session, users)

    # Create a user with no role on this project
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    outsider = UserDB(
        email=f"outsider-{uuid.uuid4().hex[:6]}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Outsider",
        is_active=True,
    )
    db_session.add(outsider)
    await db_session.commit()
    outsider_token = create_access_token(outsider.id, outsider.email)

    r = await httpx_client.get(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {outsider_token}"},
    )
    assert r.status_code in (403, 404), r.text


@pytest.mark.asyncio
async def test_non_member_gets_403_on_create(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """A user with no role on the project cannot create environments."""
    project, slug = await _make_project_with_users(db_session, users)

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    outsider = UserDB(
        email=f"outsider2-{uuid.uuid4().hex[:6]}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Outsider 2",
        is_active=True,
    )
    db_session.add(outsider)
    await db_session.commit()
    outsider_token = create_access_token(outsider.id, outsider.email)

    r = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {outsider_token}"},
        json={"name": "should-fail"},
    )
    assert r.status_code in (403, 404), r.text


@pytest.mark.asyncio
async def test_delete_environment_as_admin(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Admin can delete an environment; returns 204."""
    project, slug = await _make_project_with_users(db_session, users)
    admin_token = users["admin"]["token"]
    env_name = f"to-delete-{uuid.uuid4().hex[:6]}"

    # Create
    r_create = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": env_name},
    )
    assert r_create.status_code == 201, r_create.text
    env_id = r_create.json()["data"]["id"]

    # Delete
    r_del = await httpx_client.delete(
        f"/api/projects/{slug}/environments/{env_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_del.status_code == 204, r_del.text

    # Verify gone from list
    r_list = await httpx_client.get(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    names = [e["name"] for e in r_list.json()["data"]]
    assert env_name not in names


@pytest.mark.asyncio
async def test_delete_environment_as_editor_returns_403(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Editor (non-admin) cannot delete an environment; returns 403."""
    project, slug = await _make_project_with_users(db_session, users)
    admin_token = users["admin"]["token"]
    editor_token = users["editor"]["token"]
    env_name = f"protected-{uuid.uuid4().hex[:6]}"

    # Create as admin
    r_create = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": env_name},
    )
    assert r_create.status_code == 201, r_create.text
    env_id = r_create.json()["data"]["id"]

    # Attempt delete as editor
    r_del = await httpx_client.delete(
        f"/api/projects/{slug}/environments/{env_id}",
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r_del.status_code == 403, r_del.text


@pytest.mark.asyncio
async def test_delete_environment_as_viewer_returns_403(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Viewer cannot delete an environment; returns 403."""
    project, slug = await _make_project_with_users(db_session, users)
    admin_token = users["admin"]["token"]
    viewer_token = users["viewer"]["token"]
    env_name = f"viewer-guarded-{uuid.uuid4().hex[:6]}"

    # Create as admin
    r_create = await httpx_client.post(
        f"/api/projects/{slug}/environments",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": env_name},
    )
    assert r_create.status_code == 201, r_create.text
    env_id = r_create.json()["data"]["id"]

    # Attempt delete as viewer
    r_del = await httpx_client.delete(
        f"/api/projects/{slug}/environments/{env_id}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r_del.status_code == 403, r_del.text
