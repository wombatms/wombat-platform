"""Self-approval forbidden + cross-user approve OK.

Task 23 of SP3.2 integration tests.

Cases:
1. Admin proposes; admin tries to approve own -> 403 self_approval_forbidden.
2. Admin A proposes; Admin B approves -> 200 (cross-user approve succeeds).
3. Agent token (acting as user X admin) proposes; X tries to approve via JWT -> 403
   (author_user_id is still X; self-approval still applies).
"""

from __future__ import annotations

import hashlib
import secrets
import subprocess

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _remote_main_sha(remote) -> str:
    return subprocess.run(
        ["git", "-C", str(remote), "rev-parse", "main"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


async def _grant_roles_on_project(db_session, project, *user_role_pairs):
    """Grant roles for (user, role_name) pairs on project, then commit."""
    from wombat_api.database.models import UserProjectRoleDB

    for user, role_name in user_role_pairs:
        role_row = UserProjectRoleDB(
            user_id=user.id,
            project_id=project.id,
            role=role_name,
        )
        db_session.add(role_row)
    await db_session.commit()


@pytest.mark.asyncio
async def test_self_approval_forbidden(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Admin proposes a change; same admin attempts to approve -> 403 self_approval_forbidden."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]
    await _grant_roles_on_project(db_session, project, (admin_user, "admin"))

    base_sha = _remote_main_sha(remote)

    # Admin creates proposal.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/self-approve.md",
            "base_revision": base_sha,
            "proposed_title": "Self approval test",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Self approval test"},
                "markdown": "## Steps\n\n1. Do the thing.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Same admin tries to approve.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "I approve myself"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "self_approval_forbidden"


@pytest.mark.asyncio
async def test_cross_user_approve_succeeds(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Admin A proposes; Admin B (different user) approves -> 200."""
    project, workspace, remote = temp_git_project

    # Create a second admin user (admin B).
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB, UserProjectRoleDB

    admin_a_user = users["admin"]["user"]
    admin_a_token = users["admin"]["token"]

    admin_b = UserDB(
        email=f"admin-b-{secrets.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Admin B",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    admin_b_token = create_access_token(admin_b.id, admin_b.email)

    await _grant_roles_on_project(
        db_session,
        project,
        (admin_a_user, "admin"),
        (admin_b, "admin"),
    )

    base_sha = _remote_main_sha(remote)

    # Admin A proposes.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/cross-user-approve.md",
            "base_revision": base_sha,
            "proposed_title": "Cross-user approve test",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Cross-user approve test"},
                "markdown": "## Steps\n\n1. Admin A writes this.",
            },
        },
        headers={"Authorization": f"Bearer {admin_a_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Admin B approves.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Admin B approves"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["published_sha"]


@pytest.mark.asyncio
async def test_agent_proposer_self_approval_forbidden(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Agent token (acting as admin user X) proposes; X tries to approve via JWT -> 403.

    The author_user_id on the proposal is the user the token belongs to (X).
    Even though X now approves via JWT (not the token), the guard checks
    author_user_id == approver's user.id which is still X -> self_approval_forbidden.
    """
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]  # JWT token for X
    await _grant_roles_on_project(db_session, project, (admin_user, "admin"))

    # Create an agent API token for admin user X.
    raw_token = f"wombat_{secrets.token_urlsafe(32)}"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    from wombat_api.database.repository import Repository

    repo = Repository(db_session)
    await repo.create_api_token(
        user_id=admin_user.id,
        name="agent-token-for-admin",
        scopes=[],
        token_hash=token_hash,
        expires_at=None,
        publish_direct=False,
        purpose=None,
    )
    await db_session.commit()

    base_sha = _remote_main_sha(remote)

    # Agent (acting as admin X) creates proposal.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/agent-proposed.md",
            "base_revision": base_sha,
            "proposed_title": "Agent-proposed testcase",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Agent-proposed testcase"},
                "markdown": "## Steps\n\n1. Agent writes this.",
            },
        },
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Verify author_user_id is admin_user (X).
    author_uid = r.json()["data"]["proposal"]["author_user_id"]
    assert str(admin_user.id) == author_uid, "author_user_id should be the user the token belongs to"

    # Now user X (admin) tries to approve via their JWT session.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "I approve my own agent proposal"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "self_approval_forbidden"
