"""Parametric permission matrix for proposal routes.

Task 26 of SP3.2 integration tests.

Tests the permission matrix from spec §5.1 against the create-proposal endpoint.
For auto_approve=True cases, also covers the direct-publish permission check.

Matrix:
  role       | token_grant | auto_approve | expected_status | expected_error_code
  viewer     | None        | False        | 403             | not_permitted
  editor     | None        | False        | 201             | None
  editor     | None        | True         | 403             | direct_publish_not_permitted
  admin      | None        | False        | 201             | None
  admin      | None        | True         | 201             | None  (direct publish succeeds)
  editor     | False       | True         | 403             | direct_publish_not_permitted
  editor     | True        | True         | 201             | None  (token grant elevates)
  admin      | False       | False        | 201             | None  (token without grant, normal propose)
"""

from __future__ import annotations

import hashlib
import secrets
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "role, token_grant, auto_approve, expected_status, expected_code",
    [
        # JWT (human) principals
        ("viewer", None, False, 403, "not_permitted"),
        ("editor", None, False, 201, None),
        ("editor", None, True, 403, "direct_publish_not_permitted"),
        ("admin", None, False, 201, None),
        ("admin", None, True, 201, None),
        # API token principals (token_grant=False means publish_direct=False on token)
        ("editor", False, True, 403, "direct_publish_not_permitted"),
        ("editor", True, True, 201, None),
        ("admin", False, False, 201, None),
    ],
)
async def test_permission_matrix(
    role: str,
    token_grant,
    auto_approve: bool,
    expected_status: int,
    expected_code,
    temp_git_project,
    users,
    httpx_client: AsyncClient,
    db_session: AsyncSession,
):
    """Test the full permission matrix for proposal creation."""
    project, workspace, remote = temp_git_project

    # Get the user for the specified role.
    role_user = users[role]["user"]
    role_jwt_token = users[role]["token"]

    # Grant the role on the temp project.
    from wombat_api.database.models import UserProjectRoleDB

    role_row = UserProjectRoleDB(
        user_id=role_user.id,
        project_id=project.id,
        role=role,
    )
    db_session.add(role_row)
    await db_session.commit()

    base_sha = _remote_main_sha(remote)

    # Determine the bearer token to use.
    if token_grant is not None:
        # Use an API token with the specified publish_direct grant.
        from wombat_api.database.repository import Repository

        raw_token = f"wombat_{secrets.token_urlsafe(32)}"
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        repo = Repository(db_session)
        await repo.create_api_token(
            user_id=role_user.id,
            name=f"perm-matrix-{role}-{token_grant}",
            scopes=[],
            token_hash=token_hash,
            expires_at=None,
            publish_direct=bool(token_grant),
            purpose=None,
        )
        await db_session.commit()
        bearer_token = raw_token
    else:
        bearer_token = role_jwt_token

    # Unique source path per parametrize case to avoid conflicts.
    source_path = f"tests/perm-matrix/{role}-{token_grant}-{auto_approve}-{uuid.uuid4().hex[:8]}.md"
    auto_approve_query = "?auto_approve=true" if auto_approve else ""

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals{auto_approve_query}",
        json={
            "kind": "testcase",
            "source_path": source_path,
            "base_revision": base_sha,
            "proposed_title": f"Perm matrix: {role}/{token_grant}/{auto_approve}",
            "proposed_body": {
                "frontmatter": {
                    "kind": "testcase",
                    "title": f"Perm matrix: {role}/{token_grant}/{auto_approve}",
                },
                "markdown": "## Steps\n\n1. Permission test.",
            },
        },
        headers={"Authorization": f"Bearer {bearer_token}"},
    )

    assert r.status_code == expected_status, (
        f"role={role}, token_grant={token_grant}, auto_approve={auto_approve}: "
        f"expected {expected_status}, got {r.status_code}. Body: {r.text}"
    )

    if expected_code is not None:
        assert r.json()["error"]["code"] == expected_code, (
            f"role={role}, token_grant={token_grant}, auto_approve={auto_approve}: "
            f"expected error code {expected_code!r}, got {r.json()!r}"
        )
    elif expected_status == 201:
        # Successful creation: verify proposal or direct-publish was created.
        data = r.json()["data"]
        proposal = data.get("proposal") or data
        assert proposal, "Expected proposal data in 201 response"
