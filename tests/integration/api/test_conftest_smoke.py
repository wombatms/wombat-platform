"""Smoke test: verify API test infrastructure wires up correctly.

Uses all fixtures from conftest.py:
  - pg_container / pg_dsn: live Postgres (reused via WOMBAT_TEST_DATABASE_URL)
  - async_engine: session-scoped engine with Alembic migrations applied
  - db_session: function-scoped session
  - httpx_client: ASGI test client pointing at FastAPI app
  - seeded_project: one project in the DB
  - users: viewer/editor/admin users with bearer tokens

Asserts that all three user tokens work against GET /api/auth/me (200 OK).
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_all_three_user_tokens_authenticate(httpx_client, users):
    """Each user token must yield 200 on GET /api/auth/me."""
    for role_name, data in users.items():
        token = data["token"]
        resp = await httpx_client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, f"Role '{role_name}' got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert "id" in body, f"Missing 'id' in /me response for role '{role_name}'"
        assert body["email"] == data["user"].email, f"Email mismatch for role '{role_name}'"


@pytest.mark.asyncio
async def test_unauthenticated_me_returns_401(httpx_client):
    """GET /api/auth/me without a token must return 401."""
    resp = await httpx_client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_seeded_project_in_db(db_session, seeded_project):
    """seeded_project fixture must create a queryable project row."""
    from sqlalchemy import select

    from wombat_api.database.models import ProjectDB

    project, slug = seeded_project
    q = select(ProjectDB).where(ProjectDB.slug == slug)
    row = (await db_session.execute(q)).scalar_one_or_none()
    assert row is not None, f"Project with slug '{slug}' not found in DB"
    assert row.name == "Test Project"
