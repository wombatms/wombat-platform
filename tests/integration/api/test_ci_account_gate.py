"""Integration tests: CI-account gate enforcement (SP3.3 Task 28).

Three scenarios covering the assert_run_actor_authorized guard in the results
batch-POST route:

1. A token scoped to ``runs:record`` on Project P, whose owner is NOT the run
   owner and has not been added as an assignee on Run R → 403
   ``unauthorized_run_action``.

2. Same token after an admin PATCHes the run to add it as an assignee →
   POST /runs/R/results now returns 200.

3. Admin user (JWT) with no assignee entry on Run R → 200 (admin bypasses the
   gate entirely via ``is_admin`` shortcut).

Design note
-----------
The run is created by the ``editor`` user (see the ``run_with_1_case``
conftest fixture).  The CI token is issued by a *separate* editor-role user
(``ci_user``) so that ``principal.user.id != run.owner_id`` and the gate's
owner-check does not inadvertently pass.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_ci_user_and_token(
    db_session: AsyncSession,
    httpx_client: AsyncClient,
    project_id: uuid.UUID,
    slug: str,
) -> tuple[uuid.UUID, str, str]:
    """Create a fresh editor-role user on the project and issue a wombat_ token.

    Returns (ci_user_id, raw_wombat_token, ci_user_jwt).
    """
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB, UserProjectRoleDB

    email = f"ci-agent-{uuid.uuid4().hex[:8]}@test.example"
    ci_user = UserDB(
        email=email,
        hashed_password=hash_password("CiAgent1!"),
        display_name="CI Agent",
        is_active=True,
    )
    db_session.add(ci_user)
    await db_session.flush()

    role_row = UserProjectRoleDB(
        user_id=ci_user.id,
        project_id=project_id,
        role="editor",
    )
    db_session.add(role_row)
    await db_session.flush()
    await db_session.commit()

    ci_jwt = create_access_token(ci_user.id, email)

    # Issue a project-scoped API token with runs:record permission.
    r = await httpx_client.post(
        f"/api/projects/{slug}/tokens",
        headers={"Authorization": f"Bearer {ci_jwt}"},
        json={"name": "ci-bot", "permissions": ["runs:record", "runs:read"]},
    )
    assert r.status_code == 201, f"Token issuance failed: {r.text}"
    body = r.json()
    raw_token = body["raw_token"]
    token_db_id = body["id"]
    return ci_user.id, raw_token, token_db_id


# ---------------------------------------------------------------------------
# Scenario 1 — token is not assignee → 403
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ci_token_not_assignee_returns_403(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
    run_with_1_case,
):
    """Token holder is a project editor but not the run owner / assignee → 403."""
    project, slug = seeded_project
    run_id = run_with_1_case.id
    case_ids = run_with_1_case.case_ids

    _ci_user_id, raw_token, _token_db_id = await _make_ci_user_and_token(db_session, httpx_client, project.id, slug)

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r.status_code == 403, r.text
    body = r.json()
    # The HTTP exception handler wraps the detail dict in {"error": detail}.
    # run_guards raises HTTPException(detail={"error": {"code": ...}}) so the
    # final response is {"error": {"error": {"code": ...}}}.
    outer = body.get("error", {})
    inner = outer.get("error", outer)  # unwrap one level of nesting if present
    assert inner.get("code") == "unauthorized_run_action", f"Expected unauthorized_run_action, got: {body}"


# ---------------------------------------------------------------------------
# Scenario 2 — after admin adds token as assignee → 200
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ci_token_after_assigned_returns_200(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
    run_with_1_case,
):
    """After an admin PATCH adds the CI token as an assignee, results POST returns 200."""
    project, slug = seeded_project
    run_id = run_with_1_case.id
    case_ids = run_with_1_case.case_ids

    _ci_user_id, raw_token, token_db_id = await _make_ci_user_and_token(db_session, httpx_client, project.id, slug)

    # Pre-condition: confirm it's still 403 before assignment.
    r_pre = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r_pre.status_code == 403, f"Expected 403 before assignment, got {r_pre.status_code}"

    # Admin PATCHes run to add the CI token as an assignee.
    admin_token = users["admin"]["token"]
    r_patch = await httpx_client.patch(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"assignee_token_ids": [token_db_id]},
    )
    assert r_patch.status_code == 200, f"PATCH failed: {r_patch.text}"

    # Verify the assignee list in the response.
    patch_data = r_patch.json()["data"]
    assignee_ids = [a["id"] for a in patch_data.get("assignees", [])]
    assert token_db_id in assignee_ids, f"Token {token_db_id} not found in assignees: {assignee_ids}"

    # Now the CI token can record results.
    r_post = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {raw_token}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r_post.status_code == 200, f"Expected 200 after assignment, got: {r_post.text}"
    result_body = r_post.json()
    items = result_body["results"]
    assert len(items) == 1
    assert items[0]["ok"] is True, f"Expected ok=True, got: {items[0]}"


# ---------------------------------------------------------------------------
# Scenario 3 — admin user with no assignee entry → 200
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_with_no_assignee_entry_returns_200(
    httpx_client: AsyncClient,
    users,
    seeded_project,
    run_with_1_case,
):
    """Admin bypasses the CI-account gate entirely — no assignee entry needed."""
    slug = seeded_project[1]
    run_id = run_with_1_case.id
    case_ids = run_with_1_case.case_ids

    admin_jwt = users["admin"]["token"]

    # Admin has no assignee entry on this run (only the editor owner does).
    # Verify first via GET that no assignees reference the admin.
    r_get = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers={"Authorization": f"Bearer {admin_jwt}"},
    )
    assert r_get.status_code == 200
    run_data = r_get.json()["data"]
    admin_user_id = str(users["admin"]["user"].id)
    assignee_user_ids = [a["id"] for a in run_data.get("assignees", []) if a["principal_type"] == "user"]
    assert admin_user_id not in assignee_user_ids, "Admin should not be a listed assignee in this scenario"

    # Admin still succeeds at recording results (gate is bypassed).
    r_post = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {admin_jwt}"},
        json=[{"case_id": case_ids[0], "status": "pass"}],
    )
    assert r_post.status_code == 200, f"Admin should bypass gate: {r_post.text}"
    items = r_post.json()["results"]
    assert len(items) == 1
    assert items[0]["ok"] is True
