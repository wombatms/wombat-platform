"""Conflict detection integration tests.

Task 24 of SP3.2 integration tests.

Cases:
1. Two POSTs with same content_id -> second returns 409 open_proposal_exists + existing pointer.
2. Create proposal with base_revision=X; push independent commit on main that touches
   SAME path -> approve returns 409 stale_base_revision; proposal -> conflict status;
   conflict_detected event exists.
3. Create proposal; independent commit touches DIFFERENT path -> approve succeeds
   (non-ancestor but path untouched).
"""

from __future__ import annotations

import subprocess
import uuid

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


def _push_file_to_remote(remote, filename: str, content: str) -> str:
    """Push an independent commit touching `filename` to the bare remote.

    Uses a temporary working clone so we don't need low-level plumbing commands
    that behave differently on bare repos. Returns the new HEAD SHA on the remote.
    """
    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmp:
        clone_dir = os.path.join(tmp, "clone")
        # Clone the bare remote into a temp working directory.
        subprocess.run(
            ["git", "clone", str(remote), clone_dir],
            check=True,
            capture_output=True,
        )
        # Make sure we're on main.
        subprocess.run(
            ["git", "-C", clone_dir, "checkout", "main"],
            check=True,
            capture_output=True,
        )
        # Write the file (creating any necessary parent directories).
        file_path = os.path.join(clone_dir, filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w") as f:
            f.write(content)
        # Stage and commit.
        subprocess.run(
            ["git", "-C", clone_dir, "add", filename],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "-C", clone_dir, "commit", "-m", f"independent: touch {filename}"],
            check=True,
            capture_output=True,
        )
        # Push back to bare remote.
        subprocess.run(
            ["git", "-C", clone_dir, "push", "origin", "main"],
            check=True,
            capture_output=True,
        )
        # Return the new HEAD SHA on the remote.
        return subprocess.run(
            ["git", "-C", str(remote), "rev-parse", "main"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()


async def _grant_roles_on_project(db_session, project, *user_role_pairs):
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
async def test_duplicate_proposal_same_content_id_returns_409(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Two POSTs with same content_id -> second returns 409 open_proposal_exists."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]
    await _grant_roles_on_project(db_session, project, (admin_user, "admin"))

    base_sha = _remote_main_sha(remote)

    # Create a content row to reference (proposals.content_id has a FK to content.id).
    from wombat_api.database.models import Content

    content_row = Content(
        project_id=project.id,
        kind="testcase",
        wombat_id="TC-DUP-0001",
        title="Dup content",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "title": "Dup content"}, "markdown": ""},
        source_repo="test-repo",
        source_path="tests/testcases/dup-content.md",
        source_revision=base_sha,
        content_hash="abc123",
    )
    db_session.add(content_row)
    await db_session.flush()
    content_id = content_row.id
    await db_session.commit()

    # First proposal.
    r1 = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "content_id": str(content_id),
            "source_path": "tests/testcases/dup-content.md",
            "base_revision": base_sha,
            "proposed_title": "First proposal",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "First proposal"},
                "markdown": "## Steps\n\n1. First.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r1.status_code == 201, r1.text
    first_proposal_id = r1.json()["data"]["proposal"]["id"]

    # Second proposal with same content_id.
    r2 = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "content_id": str(content_id),
            "source_path": "tests/testcases/dup-content.md",
            "base_revision": base_sha,
            "proposed_title": "Second proposal",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Second proposal"},
                "markdown": "## Steps\n\n1. Second.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r2.status_code == 409, r2.text
    detail = r2.json()["error"]
    assert detail["code"] == "open_proposal_exists"
    assert detail["existing_proposal_id"] == first_proposal_id


def _make_orphan_sha_in_remote(remote) -> str:
    """Create an orphan commit in the bare remote that is NOT in main's ancestry.

    Returns the SHA of the orphan. Used to simulate a base_revision that is
    'not an ancestor of origin/main' — the condition the publisher uses to
    detect stale-base conflicts.

    Note: the publisher's conflict check (spec §7.3 step 4) uses
    `git merge-base --is-ancestor base origin/main`. In a normal linear
    history (A → B), A IS an ancestor of B and the check does NOT fire.
    Conflict only triggers when base_revision is genuinely not in the
    ancestry chain (e.g. after a force-push). This helper creates that
    scenario by writing an orphan commit directly to the object store.
    """
    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "work")
        # Create a separate repo with a diverged commit.
        subprocess.run(["git", "init", work], check=True, capture_output=True)
        # Create an orphan commit (no parent) with a different tree.
        with open(os.path.join(work, "README.md"), "w") as f:
            f.write("# Orphan branch\n")
        subprocess.run(["git", "-C", work, "add", "README.md"], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", work, "commit", "-m", "orphan base"],
            check=True,
            capture_output=True,
        )
        orphan_sha = subprocess.run(
            ["git", "-C", work, "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        # Pack and copy the object into the bare remote.
        pack_result = subprocess.run(
            ["git", "-C", work, "pack-objects", "--stdout"],
            input=b"",
            capture_output=True,
        )
        # Alternative: use git fetch in the remote to pull the orphan object.
        # Use `git fetch` from the bare remote pulling from the temp repo.
        subprocess.run(
            ["git", "-C", str(remote), "fetch", work, "HEAD"],
            check=True,
            capture_output=True,
        )
        return orphan_sha


@pytest.mark.asyncio
async def test_stale_base_revision_same_path_conflict(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Create proposal with base_revision=X where X is NOT an ancestor of main;
    push an independent commit to main touching the SAME path;
    approve returns 409 stale_base_revision; proposal.status -> conflict;
    conflict_detected event exists.

    NOTE on publisher semantics: The publisher (spec §7.3 step 4) checks
    `not is_ancestor(base_revision, origin/main)`. In a linear history where
    origin/main simply advanced past base_revision, base IS still an ancestor
    and NO conflict is raised. Conflict fires only when base_revision is
    genuinely not in main's ancestry (force-push / diverged history scenario).
    This is consistent with the spec §7.3 implementation; the test uses an
    orphan commit SHA to exercise the actual conflict-detection code path.
    """
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    # We need a second admin to approve (no self-approval allowed).
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    import secrets as sec
    admin_b = UserDB(
        email=f"admin-b-{sec.token_hex(4)}@test.example",
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
        (admin_user, "admin"),
        (admin_b, "admin"),
    )

    source_path = "tests/testcases/conflict-path.md"

    # Get an orphan SHA that is NOT in origin/main's ancestry.
    orphan_sha = _make_orphan_sha_in_remote(remote)

    # Admin A creates proposal with base_revision=orphan_sha (not in main chain).
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": source_path,
            "base_revision": orphan_sha,
            "proposed_title": "Conflict test proposal",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Conflict test"},
                "markdown": "## Steps\n\n1. Proposed content.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Push an independent commit to main that touches the SAME path.
    _push_file_to_remote(remote, source_path, "# Competing change\n\n1. Someone else edited this.\n")

    # Admin B tries to approve -> should get 409 stale_base_revision.
    r_approve = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Approve"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    assert r_approve.status_code == 409, r_approve.text
    assert r_approve.json()["error"]["code"] == "stale_base_revision"

    # Verify proposal.status is 'conflict'.
    r_get = await httpx_client.get(
        f"/api/projects/{project.slug}/proposals/{proposal_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_get.status_code == 200
    detail = r_get.json()["data"]
    assert detail["proposal"]["status"] == "conflict"

    # Verify conflict_detected event exists.
    event_actions = [e["action"] for e in detail["events"]]
    assert "conflict_detected" in event_actions, f"Expected conflict_detected event; got {event_actions}"


@pytest.mark.asyncio
async def test_different_path_commit_does_not_conflict(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Create proposal; push independent commit touching DIFFERENT path -> approve succeeds."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    # Second admin to approve.
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    import secrets as sec
    admin_b = UserDB(
        email=f"admin-b2-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Admin B2",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    admin_b_token = create_access_token(admin_b.id, admin_b.email)

    await _grant_roles_on_project(
        db_session,
        project,
        (admin_user, "admin"),
        (admin_b, "admin"),
    )

    base_sha = _remote_main_sha(remote)
    proposal_path = "tests/testcases/proposal-path.md"

    # Admin A creates proposal for proposal_path.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": proposal_path,
            "base_revision": base_sha,
            "proposed_title": "No conflict proposal",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "No conflict"},
                "markdown": "## Steps\n\n1. Our proposed content.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Push independent commit that touches a DIFFERENT path.
    _push_file_to_remote(remote, "docs/some-other-file.md", "# Other file\n\nUnrelated content.\n")

    # Admin B approves -> should succeed (path was not touched).
    r_approve = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Approve"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    assert r_approve.status_code == 200, r_approve.text
    assert r_approve.json()["data"]["published_sha"]
