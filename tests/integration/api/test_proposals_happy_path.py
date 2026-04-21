"""Full propose -> review -> approve -> commit lands on main.

Task 21 of SP3.2 integration tests.
"""

from __future__ import annotations

import subprocess

import pytest
from httpx import AsyncClient


def _remote_main_sha(remote) -> str:
    return subprocess.run(
        ["git", "-C", str(remote), "rev-parse", "main"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


@pytest.mark.asyncio
async def test_propose_and_approve_commits_to_main(
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session,
):
    """Editor proposes a new testcase; admin approves; commit lands on main in
    the remote and the committed file contains state: approved + approved_by."""
    project, workspace, remote = temp_git_project

    # The `users` fixture seeds users onto `seeded_project`, not our `temp_git_project`.
    # We need to grant the editor+admin roles on temp_git_project.
    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    admin_user = users["admin"]["user"]
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]

    for user, role_name in [(editor_user, "editor"), (admin_user, "admin")]:
        role_row = UserProjectRoleDB(
            user_id=user.id,
            project_id=project.id,
            role=role_name,
        )
        db_session.add(role_row)
    await db_session.commit()

    base_sha = _remote_main_sha(remote)

    # Step 1: editor creates proposal.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals",
        json={
            "kind": "testcase",
            "source_path": "tests/testcases/new.md",
            "base_revision": base_sha,
            "proposed_title": "A new testcase",
            "proposed_body": {
                "frontmatter": {"kind": "testcase", "title": "A new testcase"},
                "markdown": "## Steps\n\n1. Do the thing.",
            },
        },
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Step 2: admin approves.
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "LGTM"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    sha = r.json()["data"]["published_sha"]
    assert sha, "published_sha should be non-empty"

    # Step 3: verify commit exists on main in the remote.
    log = subprocess.run(
        ["git", "-C", str(remote), "log", "--format=%H", "main"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert sha in log.stdout, f"SHA {sha} not found in remote main log"

    # Step 4: verify file content includes review block.
    file_out = subprocess.run(
        ["git", "-C", str(remote), "show", f"{sha}:tests/testcases/new.md"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "state: approved" in file_out.stdout, "Expected 'state: approved' in committed file"
    assert "approved_by" in file_out.stdout, "Expected 'approved_by' in committed file"

    # Step 5: verify commit trailers.
    commit_msg = subprocess.run(
        ["git", "-C", str(remote), "log", "-1", "--format=%B", sha],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "Approved-by:" in commit_msg, "Expected 'Approved-by:' trailer in commit message"
    assert "Proposal-id:" in commit_msg, "Expected 'Proposal-id:' trailer in commit message"
