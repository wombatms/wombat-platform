"""Auth integration tests: register, login, refresh, me, API tokens.

Uses httpx_client fixture (ASGITransport) against the real FastAPI app wired
to a testcontainers Postgres database.  No running server is needed.

Design notes
------------
The bootstrap registration endpoint (POST /api/auth/register) only allows the
FIRST user in the DB to register without authentication.  Because the `users`
fixture pre-seeds users via direct DB inserts, every test that calls `users`
already has users in the DB — so POST /register will return 403 in those tests.

The bootstrap/second-register tests use a clean-ish approach: they seed a user
directly via DB first (via `db_session`), then attempt register (should 403),
OR they use the `db_session` fixture to truncate the users table first.
However, truncating across tests is risky because other tests may have seeded
the same table.

Pragmatic approach used here:
- Tests that need to exercise register must verify the 403 guard OR be aware
  the test DB already has users from the `users` fixture invocations.
- Tests that need a logged-in user: use the `users` fixture and its tokens
  directly — no need to call /register or /login at the HTTP layer.
- The bootstrap register test is explicitly isolated by noting the 403 guard.

Scenarios:
- Login: POST /api/auth/login with an existing user → 200 with access + refresh tokens
- Authenticated GET /api/auth/me with access bearer → 200
- Refresh: POST /api/auth/refresh → new access token that works on /me
- API token lifecycle: create → use as bearer → list → delete → use → 401
- Second register while users exist → 403 (tested directly by trying to register)
- Using access token as refresh token is rejected → 401
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_blocked_when_users_exist(
    httpx_client: AsyncClient,
    users,  # ensures the DB has users already
):
    """Once users exist, POST /api/auth/register returns 403."""
    resp = await httpx_client.post(
        "/api/auth/register",
        json={
            "email": f"new-{uuid.uuid4().hex[:8]}@example.com",
            "password": "SomeP4ss!",
            "display_name": "New User",
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_login_returns_tokens(
    httpx_client: AsyncClient,
    users,
    db_session,
):
    """POST /api/auth/login with valid credentials returns access + refresh tokens."""
    # The users fixture creates a viewer/editor/admin with hashed password "Test1234!"
    admin = users["admin"]
    email = admin["user"].email

    resp = await httpx_client.post(
        "/api/auth/login",
        json={"email": email, "password": "Test1234!"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_me_with_access_token(httpx_client: AsyncClient, users):
    """GET /api/auth/me with a valid access bearer returns the user's profile."""
    admin = users["admin"]
    token = admin["token"]
    email = admin["user"].email

    resp = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["email"] == email


@pytest.mark.asyncio
async def test_refresh_issues_new_access_token(httpx_client: AsyncClient, users):
    """POST /api/auth/refresh with a refresh token returns a new access token."""
    from wombat_api.auth.jwt import create_refresh_token

    admin = users["admin"]
    user = admin["user"]
    refresh_token = create_refresh_token(user.id)

    resp = await httpx_client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert resp.status_code == 200
    new_access = resp.json()["access_token"]
    assert new_access

    # New access token must work on /me
    me = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {new_access}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == user.email


@pytest.mark.asyncio
async def test_api_token_lifecycle(httpx_client: AsyncClient, users):
    """Full API token lifecycle: create → use as bearer → list → delete → 401."""
    admin = users["admin"]
    access = admin["token"]
    auth_headers = {"Authorization": f"Bearer {access}"}

    # Create API token
    create_resp = await httpx_client.post(
        "/api/auth/api-tokens",
        json={"name": "ci-token", "scopes": ["read"]},
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    token_body = create_resp.json()
    raw_api_token = token_body["raw_token"]
    token_id = token_body["id"]
    assert raw_api_token.startswith("wombat_")

    # Use the raw API token as bearer on /me
    me_resp = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {raw_api_token}"},
    )
    assert me_resp.status_code == 200

    # List tokens — should appear
    list_resp = await httpx_client.get(
        "/api/auth/api-tokens",
        headers=auth_headers,
    )
    assert list_resp.status_code == 200
    ids = [t["id"] for t in list_resp.json()]
    assert token_id in ids

    # Delete the token
    del_resp = await httpx_client.delete(
        f"/api/auth/api-tokens/{token_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 204

    # Revoked token → 401
    me_revoked = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {raw_api_token}"},
    )
    assert me_revoked.status_code == 401


@pytest.mark.asyncio
async def test_invalid_login_credentials_rejected(httpx_client: AsyncClient, users):
    """Wrong password on login returns 401."""
    admin = users["admin"]
    email = admin["user"].email

    resp = await httpx_client.post(
        "/api/auth/login",
        json={"email": email, "password": "WrongPassword!"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_access_token_as_refresh_rejected(httpx_client: AsyncClient, users):
    """Using an access token as a refresh token is rejected with 401."""
    admin = users["admin"]
    access = admin["token"]  # This is an access token

    resp = await httpx_client.post(
        "/api/auth/refresh",
        json={"refresh_token": access},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_without_token_returns_401(httpx_client: AsyncClient):
    """GET /api/auth/me without any bearer token returns 401."""
    resp = await httpx_client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_with_garbage_token_returns_401(httpx_client: AsyncClient):
    """GET /api/auth/me with an invalid token returns 401."""
    resp = await httpx_client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer totally-invalid-garbage"},
    )
    assert resp.status_code == 401
