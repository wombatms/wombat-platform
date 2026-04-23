"""Integration tests for SP3.4 plan route extensions: clone, resolve, start-run.

Task 8 — Plans route extensions.
Happy-path + auth rejection for each of the three new endpoints.
Detailed edge cases are deferred to Task 22.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hex() -> str:
    """Return an 8-char uppercase hex suffix safe for WombatID patterns."""
    return uuid.uuid4().hex[:8].upper()


async def _seed_plan(db_session: AsyncSession, project_id: uuid.UUID, wombat_id: str, **body_overrides) -> None:
    """Insert a plan content row directly into the DB."""
    from wombat_api.database.models import Content

    body = {
        "title": "Payments regression",
        "description": "Seeded plan",
        "include": {"tags_any": ["payments"], "tags_all": [], "components_any": [], "priorities": []},
        "exclude": {"tags_any": [], "tags_all": [], "components_any": [], "priorities": []},
        "suite_refs": [],
        "explicit_cases": {"add": [], "remove": []},
        "environments": [{"name": "staging", "config": {}}],
        "execution": "manual",
        "assignees": ["@qa-team"],
        "approvals": [],
        **body_overrides,
    }
    row = Content(
        project_id=project_id,
        kind="plan",
        wombat_id=wombat_id,
        title=body.get("title", "Plan"),
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"plans/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    await db_session.commit()


# ---------------------------------------------------------------------------
# GET /{project_slug}/plans/{wombat_id}/resolve
# ---------------------------------------------------------------------------


async def test_resolve_plan_empty(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Resolve a plan with no matching cases returns count=0 and empty list."""
    project, slug = seeded_project
    wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, wid)

    token = users["editor"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/plans/{wid}/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["count"] == 0
    assert data["cases"] == []
    assert isinstance(data["warnings"], list)


async def test_resolve_plan_with_explicit_add(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Resolve a plan that has an explicit_cases.add entry."""
    from wombat_api.database.models import Content

    project, slug = seeded_project
    suffix = _hex()
    tc_wid = f"TC-{suffix}"
    tc = Content(
        project_id=project.id,
        kind="testcase",
        wombat_id=tc_wid,
        title="A testcase",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "id": tc_wid}, "markdown": "steps"},
        source_repo="test-repo",
        source_path=f"tests/{tc_wid}.md",
        source_revision="abc123",
        content_hash=f"hash-{tc_wid}",
    )
    db_session.add(tc)
    await db_session.commit()

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(
        db_session,
        project.id,
        plan_wid,
        explicit_cases={"add": [tc_wid], "remove": []},
    )

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/plans/{plan_wid}/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["count"] == 1
    assert data["cases"][0]["wombat_id"] == tc_wid
    assert data["cases"][0]["source"] == "explicit_add"


async def test_resolve_plan_not_found(
    httpx_client: AsyncClient,
    seeded_project,
    users,
):
    """Resolve an unknown plan wombat_id returns 404."""
    _, slug = seeded_project
    token = users["editor"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/plans/PLAN-DOESNOTEXIST/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


async def test_resolve_plan_unauthenticated(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Resolve without a token returns 401/403."""
    _, slug = seeded_project
    r = await httpx_client.get(f"/api/projects/{slug}/plans/PLAN-X/resolve")
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# POST /{project_slug}/plans/{wombat_id}/clone
# ---------------------------------------------------------------------------


async def test_clone_plan_creates_proposal(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """Clone an existing plan produces an open proposal with a new wombat_id."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    admin_user = users["admin"]["user"]
    editor_token = users["editor"]["token"]

    for user, role_name in [(editor_user, "editor"), (admin_user, "admin")]:
        db_session.add(UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name))
    await db_session.commit()

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    new_wid = f"PLAN-{_hex()}"
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": new_wid, "title": "Cloned plan"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]
    assert "proposal" in data
    proposal = data["proposal"]
    assert proposal["kind"] == "plan"
    assert proposal["status"] == "open"
    assert proposal["proposed_title"] == "Cloned plan"


async def test_clone_plan_default_title(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """Clone without supplying a title gets '{src_title} (clone)' as the default."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    editor_token = users["editor"]["token"]
    db_session.add(UserProjectRoleDB(user_id=editor_user.id, project_id=project.id, role="editor"))
    await db_session.commit()

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid, title="Original Plan")

    new_wid = f"PLAN-{_hex()}"
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": new_wid},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 201, r.text
    proposal = r.json()["data"]["proposal"]
    assert proposal["proposed_title"] == "Original Plan (clone)"


async def test_clone_plan_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """A viewer (without content:propose) cannot clone a plan."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    viewer_token = users["viewer"]["token"]
    db_session.add(UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer"))
    await db_session.commit()

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": "PLAN-CLONEX"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403


async def test_clone_plan_source_not_found(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """Cloning a non-existent plan returns 404."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    editor_token = users["editor"]["token"]
    db_session.add(UserProjectRoleDB(user_id=editor_user.id, project_id=project.id, role="editor"))
    await db_session.commit()

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/PLAN-NONEXIST/clone",
        json={"new_wombat_id": "PLAN-CLONEY"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 404


async def test_clone_plan_unauthenticated(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Clone without a token returns 401/403."""
    _, slug = seeded_project
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/PLAN-X/clone",
        json={"new_wombat_id": "PLAN-CLONEZ"},
    )
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# POST /{project_slug}/plans/{wombat_id}/start-run
# ---------------------------------------------------------------------------


async def test_start_run_draft_returns_draft(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """start-run returns a StartRunDraft without creating a run."""
    project, slug = seeded_project
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(
        db_session,
        project.id,
        plan_wid,
        environments=[{"name": "staging", "config": {}}, {"name": "prod", "config": {}}],
        assignees=["@alice", "@bob"],
    )

    token = users["editor"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/start-run",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["plan_wombat_id"] == plan_wid
    assert data["plan_revision"] == "abc123"
    assert "title_suggestion" in data
    assert data["environments"] == [{"name": "staging", "config": {}}, {"name": "prod", "config": {}}]
    assert data["assignees"] == ["@alice", "@bob"]
    assert "case_count" in data
    assert isinstance(data["case_count"], int)


async def test_start_run_draft_not_found(
    httpx_client: AsyncClient,
    seeded_project,
    users,
):
    """start-run on a non-existent plan returns 404."""
    _, slug = seeded_project
    token = users["editor"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/PLAN-DOESNOTEXIST/start-run",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


async def test_start_run_draft_unauthenticated(
    httpx_client: AsyncClient,
    seeded_project,
):
    """start-run without a token returns 401/403."""
    _, slug = seeded_project
    r = await httpx_client.post(f"/api/projects/{slug}/plans/PLAN-X/start-run")
    assert r.status_code in (401, 403)


async def test_start_run_draft_viewer_allowed(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A viewer can call start-run (content read is authenticated + project-scoped only)."""
    project, slug = seeded_project
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    token = users["viewer"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/start-run",
        headers={"Authorization": f"Bearer {token}"},
    )
    # viewer has no runs:create permission, but start-run is a draft-generation
    # read-style endpoint, not a run creation.  It should be allowed.
    assert r.status_code == 200, r.text
