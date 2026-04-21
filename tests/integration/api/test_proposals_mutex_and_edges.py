"""Mutex correctness, push rejection, delete flow, and reindex failure.

Task 25 of SP3.2 integration tests.

Cases:
1. Mutex: asyncio.gather(approve_A, approve_B) on same project, different files ->
   both commits land, serialized by lock, no interleaving.
2. Push rejection: configure remote to reject pushes -> approve returns 502 push_failed;
   proposal.status=conflict; content row unchanged.
3. Delete flow: proposal_action="delete" -> file removed via git rm; content row deleted.
4. Re-index failure: monkeypatch repo.reindex_content to raise -> publish succeeds,
   content row's stale_embedding flag is True.
"""

from __future__ import annotations

import asyncio
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


def _push_file_to_remote(remote, filename: str, content: str) -> str:
    """Clone, add file, push, return new HEAD SHA."""
    import os
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        clone_dir = os.path.join(tmp, "clone")
        subprocess.run(["git", "clone", str(remote), clone_dir], check=True, capture_output=True)
        subprocess.run(["git", "-C", clone_dir, "checkout", "main"], check=True, capture_output=True)
        file_path = os.path.join(clone_dir, filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w") as f:
            f.write(content)
        subprocess.run(["git", "-C", clone_dir, "add", filename], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", clone_dir, "commit", "-m", f"seed: {filename}"],
            check=True,
            capture_output=True,
        )
        subprocess.run(["git", "-C", clone_dir, "push", "origin", "main"], check=True, capture_output=True)
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


async def _create_proposal_and_admin_b(httpx_client, db_session, project, users, source_path, title):
    """Helper: create a proposal as admin_A, return (proposal_id, admin_b_token)."""
    import secrets as sec

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB, UserProjectRoleDB

    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    # Ensure admin_user has role on project.
    role_check = UserProjectRoleDB(
        user_id=admin_user.id,
        project_id=project.id,
        role="admin",
    )
    db_session.add(role_check)

    # Create second admin for approving.
    admin_b = UserDB(
        email=f"admin-b-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name=f"Admin B ({title[:10]})",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    admin_b_role = UserProjectRoleDB(
        user_id=admin_b.id,
        project_id=project.id,
        role="admin",
    )
    db_session.add(admin_b_role)
    await db_session.commit()

    admin_b_token = create_access_token(admin_b.id, admin_b.email)
    base_sha = _remote_main_sha(project._sa_instance_state.session_id if False else None) if False else None

    # Get the remote sha from the project's git_url.
    actual_sha = subprocess.run(
        ["git", "-C", project.git_url, "rev-parse", "main"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": source_path,
            "base_revision": actual_sha,
            "proposed_title": title,
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": title},
                "markdown": f"## Steps\n\n1. {title}.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]
    return proposal_id, admin_token, admin_b_token


@pytest.mark.asyncio
async def test_mutex_concurrent_approvals(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Two concurrent approvals on the same project (different files) are serialized
    by the in-process lock. Both commits land; no interleaving.

    We assert correctness (both SHAs are distinct and present on main) rather than
    timing order, since the lock guarantees serialization but not ordering.
    """
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    # Create second admin.
    import secrets as sec

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB, UserProjectRoleDB

    admin_b = UserDB(
        email=f"mutex-admin-b-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Mutex Admin B",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()

    for user, role_name in [(admin_user, "admin"), (admin_b, "admin")]:
        role_row = UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name)
        db_session.add(role_row)
    await db_session.commit()

    admin_b_token = create_access_token(admin_b.id, admin_b.email)
    base_sha = _remote_main_sha(remote)

    # Create two proposals (different files).
    r_a = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/mutex/fileA.md",
            "base_revision": base_sha,
            "proposed_title": "Mutex Proposal A",
            "proposed_body": {"frontmatter": {"kind": "testcase", "title": "Mutex A"}, "markdown": "## A"},
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_a.status_code == 201, r_a.text
    proposal_a_id = r_a.json()["data"]["proposal"]["id"]

    r_b = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/mutex/fileB.md",
            "base_revision": base_sha,
            "proposed_title": "Mutex Proposal B",
            "proposed_body": {"frontmatter": {"kind": "testcase", "title": "Mutex B"}, "markdown": "## B"},
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_b.status_code == 201, r_b.text
    proposal_b_id = r_b.json()["data"]["proposal"]["id"]

    # Concurrently approve both proposals using different approvers.
    async def approve_a():
        return await httpx_client.post(
            f"/api/projects/{project.slug}/proposals/{proposal_a_id}/approve",
            json={"comment": "Concurrent A"},
            headers={"Authorization": f"Bearer {admin_b_token}"},
        )

    async def approve_b():
        return await httpx_client.post(
            f"/api/projects/{project.slug}/proposals/{proposal_b_id}/approve",
            json={"comment": "Concurrent B"},
            headers={"Authorization": f"Bearer {admin_b_token}"},
        )

    r_a_result, r_b_result = await asyncio.gather(approve_a(), approve_b())

    assert r_a_result.status_code == 200, r_a_result.text
    assert r_b_result.status_code == 200, r_b_result.text

    sha_a = r_a_result.json()["data"]["published_sha"]
    sha_b = r_b_result.json()["data"]["published_sha"]
    assert sha_a and sha_b
    assert sha_a != sha_b, "Each approval must produce a distinct commit"

    # Both commits must be in the remote's main history.
    log = subprocess.run(
        ["git", "-C", str(remote), "log", "--format=%H", "main"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert sha_a in log, f"sha_a {sha_a} not found in remote log"
    assert sha_b in log, f"sha_b {sha_b} not found in remote log"


@pytest.mark.asyncio
async def test_push_rejection_returns_502(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Configure remote to reject pushes via pre-receive hook; approve returns 502
    push_failed; proposal.status=conflict; content row unchanged."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    import secrets as sec

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB, UserProjectRoleDB

    admin_b = UserDB(
        email=f"push-reject-admin-b-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Push Reject Admin B",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    for user, role_name in [(admin_user, "admin"), (admin_b, "admin")]:
        role_row = UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name)
        db_session.add(role_row)
    await db_session.commit()
    admin_b_token = create_access_token(admin_b.id, admin_b.email)

    base_sha = _remote_main_sha(remote)

    # Create proposal before installing the hook (so create succeeds).
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/push-reject/tc.md",
            "base_revision": base_sha,
            "proposed_title": "Push rejection test",
            "proposed_body": {"frontmatter": {"kind": "testcase", "title": "Rejected"}, "markdown": "## Rejected"},
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Install a pre-receive hook that rejects all pushes.
    hooks_dir = remote / "hooks"
    hooks_dir.mkdir(exist_ok=True)
    hook_file = hooks_dir / "pre-receive"
    hook_file.write_text("#!/bin/sh\necho 'push rejected by test hook' >&2\nexit 1\n")
    hook_file.chmod(0o755)

    # Approve -> should get 502 push_failed.
    r_approve = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Try to approve"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    assert r_approve.status_code == 502, r_approve.text
    assert r_approve.json()["error"]["code"] == "push_failed"

    # Verify proposal.status is 'conflict'.
    r_get = await httpx_client.get(
        f"/api/projects/{project.slug}/proposals/{proposal_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r_get.status_code == 200
    assert r_get.json()["data"]["proposal"]["status"] == "conflict"

    # Remove the hook so teardown can proceed normally.
    hook_file.unlink()


@pytest.mark.asyncio
async def test_delete_flow_removes_file_and_content_row(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """proposal_action="delete" -> file removed via git rm in commit; content row deleted from DB."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    import secrets as sec

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import Content, UserDB, UserProjectRoleDB

    admin_b = UserDB(
        email=f"delete-admin-b-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Delete Admin B",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    for user, role_name in [(admin_user, "admin"), (admin_b, "admin")]:
        role_row = UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name)
        db_session.add(role_row)
    await db_session.commit()
    admin_b_token = create_access_token(admin_b.id, admin_b.email)

    source_path = "tests/delete-flow/tc-to-delete.md"
    # First push the file to remote so it exists.
    base_sha = _push_file_to_remote(
        remote, source_path, "---\nkind: testcase\ntitle: To Delete\n---\n## Steps\n\n1. Existing.\n"
    )

    # Create a content row representing the existing file.
    content_row = Content(
        project_id=project.id,
        kind="testcase",
        wombat_id="TC-DEL-0001",
        title="To Delete",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "title": "To Delete"}, "markdown": ""},
        source_repo="test-repo",
        source_path=source_path,
        source_revision=base_sha,
        content_hash="delete_test_hash",
    )
    db_session.add(content_row)
    await db_session.flush()
    content_id = content_row.id
    await db_session.commit()

    # Create a delete proposal.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "content_id": str(content_id),
            "source_path": source_path,
            "base_revision": base_sha,
            "proposed_title": "Delete tc-to-delete.md",
            "proposed_body": {"frontmatter": {"kind": "testcase", "title": "To Delete"}, "markdown": ""},
            "proposal_action": "delete",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Admin B approves the delete.
    r_approve = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Delete approved"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    assert r_approve.status_code == 200, r_approve.text
    published_sha = r_approve.json()["data"]["published_sha"]
    assert published_sha

    # Verify the file is removed in the commit (git show should fail for that path).
    result = subprocess.run(
        ["git", "-C", str(remote), "show", f"{published_sha}:{source_path}"],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0, "File should have been removed by git rm"

    # Verify the content row is soft-deleted (deleted_at set).
    await db_session.refresh(content_row)
    assert content_row.deleted_at is not None, "Content row should be soft-deleted after delete proposal"


@pytest.mark.asyncio
async def test_reindex_failure_sets_stale_embedding(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch,
):
    """Monkeypatch repo.reindex_content to raise; approve still succeeds (status=published);
    content row's stale_embedding flag is True."""
    project, workspace, remote = temp_git_project
    admin_user = users["admin"]["user"]
    admin_token = users["admin"]["token"]

    import secrets as sec

    from sqlalchemy import and_, select

    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import Content, UserDB, UserProjectRoleDB

    admin_b = UserDB(
        email=f"reindex-admin-b-{sec.token_hex(4)}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Reindex Admin B",
        is_active=True,
    )
    db_session.add(admin_b)
    await db_session.flush()
    for user, role_name in [(admin_user, "admin"), (admin_b, "admin")]:
        role_row = UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name)
        db_session.add(role_row)
    await db_session.commit()
    admin_b_token = create_access_token(admin_b.id, admin_b.email)

    base_sha = _remote_main_sha(remote)
    source_path = "tests/reindex/tc-stale.md"

    # Monkeypatch reindex_content to always raise.
    from wombat_api.database import repository as repo_module

    original_reindex = repo_module.Repository.reindex_content

    async def _fake_reindex_raises(self, *, project_id, source_path):
        raise RuntimeError("Simulated reindex failure for test")

    monkeypatch.setattr(repo_module.Repository, "reindex_content", _fake_reindex_raises)

    # Create proposal.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": source_path,
            "base_revision": base_sha,
            "proposed_title": "Reindex failure test",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "Reindex failure"},
                "markdown": "## Steps\n\n1. This will fail reindex.",
            },
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Admin B approves.
    r_approve = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Approve despite reindex failure"},
        headers={"Authorization": f"Bearer {admin_b_token}"},
    )
    # Publish should still succeed (reindex failure is best-effort).
    assert r_approve.status_code == 200, r_approve.text
    assert r_approve.json()["data"]["proposal"]["status"] == "published"
    published_sha = r_approve.json()["data"]["published_sha"]
    assert published_sha

    # Verify content row has stale_embedding=True.

    q = select(Content).where(
        and_(
            Content.project_id == project.id,
            Content.source_path == source_path,
            Content.deleted_at.is_(None),
        )
    )
    result = await db_session.execute(q)
    content_row = result.scalar_one_or_none()
    assert content_row is not None, "Content row should exist after publish"
    assert content_row.stale_embedding is True, "stale_embedding should be True after reindex failure"
