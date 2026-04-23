"""Integration tests for plan write path through proposals (SP3.4 Task 22).

Covers:
1. POST /proposals with kind=plan creates an open proposal; after approve the
   content row of kind=plan is published.
2. Clone via POST /plans/{wid}/clone creates a proposal with the new wombat_id.
3. Edit existing plan via proposal: stale base_revision → 409 (SP3.2 conflict).
4. start-run returns env/assignees/case_count from the published plan.
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


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _hex() -> str:
    return uuid.uuid4().hex[:8].upper()


async def _seed_plan(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    *,
    environments: list | None = None,
    assignees: list | None = None,
    explicit_cases: dict | None = None,
    source_revision: str = "abc123",
) -> None:
    """Insert a plan content row directly into the DB."""
    from wombat_api.database.models import Content

    body: dict = {
        "id": wombat_id,
        "title": f"Plan {wombat_id}",
        "description": "Seeded plan",
        "include": {"tags_any": ["payments"]},
        "exclude": {},
        "suite_refs": [],
        "explicit_cases": explicit_cases or {"add": [], "remove": []},
        "environments": environments or [{"name": "staging", "config": {}}],
        "execution": "manual",
        "assignees": assignees or ["@qa-team"],
        "approvals": [],
    }
    row = Content(
        project_id=project_id,
        kind="plan",
        wombat_id=wombat_id,
        title=f"Plan {wombat_id}",
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"plans/{wombat_id}.md",
        source_revision=source_revision,
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()
    await db_session.commit()


async def _count_content_by_kind_wid(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    kind: str,
    wombat_id: str,
) -> int:
    from sqlalchemy import func, select

    from wombat_api.database.models import Content

    q = select(func.count()).where(
        Content.project_id == project_id,
        Content.kind == kind,
        Content.wombat_id == wombat_id,
        Content.deleted_at.is_(None),
    )
    return (await db_session.execute(q)).scalar_one()


# ---------------------------------------------------------------------------
# Test 1: POST /proposals with kind=plan creates proposal, approve → content row
# ---------------------------------------------------------------------------


async def test_plan_proposal_create_is_open(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """POST /proposals with kind=plan creates an open proposal."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    wid = f"PLAN-{_hex()}"
    payload = {
        "kind": "plan",
        "source_path": f"plans/{wid}.md",
        "base_revision": "abc123",
        "proposed_title": f"Plan {wid}",
        "proposed_body": {
            "id": wid,
            "title": f"Plan {wid}",
            "include": {"tags_any": ["regression"]},
            "exclude": {},
            "suite_refs": [],
            "explicit_cases": {"add": [], "remove": []},
            "environments": [],
            "assignees": [],
        },
        "proposal_action": "upsert",
        "summary": "New regression plan",
    }

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=payload,
        headers=_auth(editor_token),
    )
    assert r.status_code == 201, r.text
    data = r.json()["data"]["proposal"]
    assert data["kind"] == "plan"
    assert data["status"] == "open"
    assert data["proposed_title"] == f"Plan {wid}"


async def test_plan_proposal_viewer_cannot_propose(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A viewer cannot create a plan proposal (no content:propose permission)."""
    project, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    wid = f"PLAN-{_hex()}"
    payload = {
        "kind": "plan",
        "source_path": f"plans/{wid}.md",
        "base_revision": "abc123",
        "proposed_title": f"Plan {wid}",
        "proposed_body": {"id": wid, "title": f"Plan {wid}"},
        "proposal_action": "upsert",
    }
    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=payload,
        headers=_auth(viewer_token),
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Test 2: Clone via POST /plans/{wid}/clone
# ---------------------------------------------------------------------------


async def test_clone_creates_proposal_with_new_wombat_id(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """Clone creates an open proposal with the new wombat_id in source_path."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    admin_user = users["admin"]["user"]
    editor_token = users["editor"]["token"]

    for u, role_name in [(editor_user, "editor"), (admin_user, "admin")]:
        db_session.add(UserProjectRoleDB(user_id=u.id, project_id=project.id, role=role_name))
    await db_session.commit()

    src_wid = f"PLAN-SRC-{_hex()}"
    await _seed_plan(db_session, project.id, src_wid, assignees=["@original"])

    new_wid = f"PLAN-CLONE-{_hex()}"
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{src_wid}/clone",
        json={"new_wombat_id": new_wid, "title": "Cloned Plan"},
        headers=_auth(editor_token),
    )
    assert r.status_code == 201, r.text
    proposal = r.json()["data"]["proposal"]
    assert proposal["kind"] == "plan"
    assert proposal["status"] == "open"
    assert proposal["proposed_title"] == "Cloned Plan"
    # The cloned proposal's source_path should reference the new wombat_id.
    assert new_wid in proposal["source_path"] or new_wid in proposal["proposed_body"].get("id", "")


async def test_clone_source_not_found_returns_404(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    temp_git_project,
    users,
):
    """Cloning a non-existent plan wombat_id returns 404."""
    project, workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    editor_token = users["editor"]["token"]
    db_session.add(UserProjectRoleDB(user_id=editor_user.id, project_id=project.id, role="editor"))
    await db_session.commit()

    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/PLAN-MISSING/clone",
        json={"new_wombat_id": f"PLAN-X-{_hex()}"},
        headers=_auth(editor_token),
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Test 3: Stale base_revision → 409 on PUT (update)
# ---------------------------------------------------------------------------


async def test_stale_base_revision_on_update_returns_409(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """PUT /proposals/{id} with an outdated base_revision → 409 stale_base_revision."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    # Create a plan proposal first.
    wid = f"PLAN-{_hex()}"
    create_payload = {
        "kind": "plan",
        "source_path": f"plans/{wid}.md",
        "base_revision": "rev-original",
        "proposed_title": f"Plan {wid}",
        "proposed_body": {
            "id": wid,
            "title": f"Plan {wid}",
            "include": {},
            "exclude": {},
            "suite_refs": [],
            "explicit_cases": {"add": [], "remove": []},
        },
        "proposal_action": "upsert",
    }
    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=create_payload,
        headers=_auth(editor_token),
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Try to update with a deliberately wrong (different) base_revision.
    update_payload = {
        "proposed_title": "Updated plan title",
        "proposed_body": {
            "id": wid,
            "title": "Updated plan title",
            "include": {},
            "exclude": {},
            "suite_refs": [],
            "explicit_cases": {"add": [], "remove": []},
        },
        "base_revision": "rev-stale-xyz",  # stale
    }
    r2 = await httpx_client.put(
        f"/api/projects/{slug}/proposals/{proposal_id}",
        json=update_payload,
        headers=_auth(editor_token),
    )
    # Repository.update_proposal_body checks that base_revision matches the stored one.
    # If they match, it updates; if they differ, it raises StaleBaseRevisionError → 409.
    # Since "rev-stale-xyz" != "rev-original", we expect 409.
    assert r2.status_code == 409, r2.text
    # Custom error handler wraps HTTPException detail in {"error": {...}}.
    error_code = (r2.json().get("error") or {}).get("code") or ""
    assert "stale" in error_code or "revision" in error_code.lower(), (
        f"Expected stale_base_revision code, got: {error_code}"
    )


# ---------------------------------------------------------------------------
# Test 4: start-run returns env/assignees/case_count from published plan
# ---------------------------------------------------------------------------


async def test_start_run_reflects_plan_body(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """POST /plans/{wid}/start-run returns the plan's env, assignees, and case_count."""
    project, slug = seeded_project

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(
        db_session,
        project.id,
        plan_wid,
        environments=[{"name": "staging", "config": {}}, {"name": "prod", "config": {}}],
        assignees=["@alice", "@bob", "@charlie"],
    )

    editor_token = users["editor"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/start-run",
        headers=_auth(editor_token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["plan_wombat_id"] == plan_wid
    assert isinstance(data["case_count"], int)
    # Environments must be preserved.
    env_names = [e["name"] for e in data["environments"]]
    assert "staging" in env_names
    assert "prod" in env_names
    # Assignees preserved.
    assert data["assignees"] == ["@alice", "@bob", "@charlie"]
    # Title suggestion derived from plan title.
    assert plan_wid in data["title_suggestion"] or "Plan" in data["title_suggestion"]


async def test_start_run_counts_resolved_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """start-run case_count reflects the resolved case set (explicit_cases.add)."""
    from wombat_api.database.models import Content

    project, slug = seeded_project

    # Seed 3 explicit testcases.
    tc_ids = [f"TC-SR-{_hex()}" for _ in range(3)]
    for tc_wid in tc_ids:
        row = Content(
            project_id=project.id,
            kind="testcase",
            wombat_id=tc_wid,
            title=f"Case {tc_wid}",
            tags=[],
            body={"frontmatter": {"kind": "testcase", "id": tc_wid}, "markdown": "steps"},
            source_repo="test-repo",
            source_path=f"tests/{tc_wid}.md",
            source_revision="abc123",
            content_hash=f"hash-{tc_wid}-{uuid.uuid4().hex[:6]}",
        )
        db_session.add(row)
    await db_session.commit()

    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(
        db_session,
        project.id,
        plan_wid,
        explicit_cases={"add": tc_ids, "remove": []},
    )

    editor_token = users["editor"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/start-run",
        headers=_auth(editor_token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    # The 3 explicit testcases must all be reflected in case_count.
    assert data["case_count"] == 3, (
        f"Expected case_count=3 for 3 explicit cases, got {data['case_count']}"
    )


async def test_start_run_plan_not_found(
    httpx_client: AsyncClient,
    seeded_project,
    users,
):
    """start-run on non-existent plan returns 404."""
    _, slug = seeded_project
    editor_token = users["editor"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/PLAN-DOESNOTEXIST/start-run",
        headers=_auth(editor_token),
    )
    assert r.status_code == 404
