"""Direct-publish and agent-bypass integration tests.

Task 22 of SP3.2 integration tests.

Cases:
1. Admin + ?auto_approve=true -> single commit, event `direct_published`, trailer Published-directly-by.
2. API token with publish_direct=True + purpose -> commit trailer includes Purpose:; event detail.purpose matches.
3. API token without publish_direct grant + ?auto_approve=true -> 403 direct_publish_not_permitted.
4. Editor user + ?auto_approve=true -> 403 direct_publish_not_permitted.
5. Admin user + auto_approve=false (default) -> normal proposal; status=open.
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


async def _grant_roles_on_project(db_session, users, project):
    """Grant roles from `users` fixture onto the given project."""
    from wombat_api.database.models import UserProjectRoleDB

    for role_name in ("admin", "editor", "viewer"):
        role_row = UserProjectRoleDB(
            user_id=users[role_name]["user"].id,
            project_id=project.id,
            role=role_name,
        )
        db_session.add(role_row)
    await db_session.commit()


@pytest.mark.asyncio
async def test_admin_auto_approve_direct_published(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Admin + ?auto_approve=true -> single commit, direct_published event, Published-directly-by trailer."""
    project, workspace, remote = temp_git_project
    await _grant_roles_on_project(db_session, users, project)

    admin_token = users["admin"]["token"]
    base_sha = _remote_main_sha(remote)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals?auto_approve=true",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/admin-direct.md",
            "base_revision": base_sha,
            "proposed_title": "Admin direct publish",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Admin direct publish"},
                "markdown": "## Steps\n\n1. Admin does it directly.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    published_sha = data["published_sha"]
    assert published_sha, "published_sha must be set for direct-published proposals"

    proposal_status = data["proposal"]["status"]
    assert proposal_status == "published"

    # Check commit exists on remote main.
    log = subprocess.run(
        ["git", "-C", str(remote), "log", "--format=%H", "main"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert published_sha in log.stdout

    # Check commit message has Published-directly-by trailer.
    commit_msg = subprocess.run(
        ["git", "-C", str(remote), "log", "-1", "--format=%B", published_sha],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "Published-directly-by:" in commit_msg, f"Expected Published-directly-by trailer; got:\n{commit_msg}"

    # Check direct_published event exists via GET proposal.
    proposal_id = data["proposal"]["id"]
    r2 = await httpx_client.get(
        f"/api/projects/{project.slug}/proposals/{proposal_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r2.status_code == 200
    events = r2.json()["data"]["events"]
    event_actions = [e["action"] for e in events]
    assert "direct_published" in event_actions, f"Expected direct_published event; got {event_actions}"


@pytest.mark.asyncio
async def test_api_token_with_publish_direct_and_purpose(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """API token with publish_direct=True + purpose -> Purpose: trailer in commit, event detail.purpose matches."""
    project, workspace, remote = temp_git_project
    await _grant_roles_on_project(db_session, users, project)

    # Create an API token with publish_direct=True and a purpose.
    from wombat_api.database.repository import Repository

    editor_user = users["editor"]["user"]
    raw_token = f"wombat_{secrets.token_urlsafe(32)}"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    repo = Repository(db_session)
    await repo.create_api_token(
        user_id=editor_user.id,
        name="test-agent-token",
        scopes=[],
        token_hash=token_hash,
        expires_at=None,
        publish_direct=True,
        purpose="automated-test-suite",
    )
    await db_session.commit()

    base_sha = _remote_main_sha(remote)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals?auto_approve=true",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/agent-direct.md",
            "base_revision": base_sha,
            "proposed_title": "Agent direct publish",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Agent direct publish"},
                "markdown": "## Steps\n\n1. Agent does it.",
            },
        },
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    published_sha = data["published_sha"]
    assert published_sha

    # Verify Purpose: trailer in commit message.
    commit_msg = subprocess.run(
        ["git", "-C", str(remote), "log", "-1", "--format=%B", published_sha],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "Purpose: automated-test-suite" in commit_msg, f"Expected Purpose: trailer; got:\n{commit_msg}"

    # Verify event detail.purpose matches.
    proposal_id = data["proposal"]["id"]
    r2 = await httpx_client.get(
        f"/api/projects/{project.slug}/proposals/{proposal_id}",
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r2.status_code == 200
    events = r2.json()["data"]["events"]
    direct_event = next((e for e in events if e["action"] == "direct_published"), None)
    assert direct_event is not None, "direct_published event not found"
    assert direct_event["detail"]["purpose"] == "automated-test-suite"


@pytest.mark.asyncio
async def test_api_token_without_publish_direct_blocked(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """API token without publish_direct grant + ?auto_approve=true -> 403 direct_publish_not_permitted."""
    project, workspace, remote = temp_git_project
    await _grant_roles_on_project(db_session, users, project)

    editor_user = users["editor"]["user"]
    raw_token = f"wombat_{secrets.token_urlsafe(32)}"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    from wombat_api.database.repository import Repository

    repo = Repository(db_session)
    await repo.create_api_token(
        user_id=editor_user.id,
        name="test-no-grant-token",
        scopes=[],
        token_hash=token_hash,
        expires_at=None,
        publish_direct=False,  # no grant
        purpose=None,
    )
    await db_session.commit()

    base_sha = _remote_main_sha(remote)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals?auto_approve=true",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/blocked.md",
            "base_revision": base_sha,
            "proposed_title": "Should be blocked",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Should be blocked"},
                "markdown": "## Steps\n\n1. This should not go through.",
            },
        },
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "direct_publish_not_permitted"


@pytest.mark.asyncio
async def test_editor_auto_approve_blocked(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Editor user (JWT) + ?auto_approve=true -> 403 direct_publish_not_permitted."""
    project, workspace, remote = temp_git_project
    await _grant_roles_on_project(db_session, users, project)

    editor_token = users["editor"]["token"]
    base_sha = _remote_main_sha(remote)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals?auto_approve=true",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/editor-blocked.md",
            "base_revision": base_sha,
            "proposed_title": "Editor cannot auto-approve",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Editor cannot auto-approve"},
                "markdown": "## Steps\n\n1. Nope.",
            },
        },
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "direct_publish_not_permitted"


@pytest.mark.asyncio
async def test_admin_without_auto_approve_creates_open_proposal(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Admin user + auto_approve=false (default) -> normal open proposal, no commit."""
    project, workspace, remote = temp_git_project
    await _grant_roles_on_project(db_session, users, project)

    admin_token = users["admin"]["token"]
    initial_sha = _remote_main_sha(remote)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/normal-proposal.md",
            "base_revision": initial_sha,
            "proposed_title": "Normal admin proposal",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Normal admin proposal"},
                "markdown": "## Steps\n\n1. This is a normal proposal.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]["proposal"]
    assert data["status"] == "open"
    assert data.get("published_sha") is None

    # Remote HEAD should not have changed.
    final_sha = _remote_main_sha(remote)
    assert final_sha == initial_sha, "No commit should have been pushed for a normal proposal"
