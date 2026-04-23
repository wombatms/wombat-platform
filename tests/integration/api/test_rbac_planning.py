"""SP3.4 RBAC integration tests: plan/suite writes + dashboard widget reads.

Task 28 — plan/suite write RBAC
================================
Plans and suites are *content kinds* that flow through SP3.2's proposal path.
Writes therefore require the same permission slugs as any other content write:
  - ``content:propose``  — to open a proposal with ``kind=plan`` or ``kind=suite``
  - ``content:publish_direct``  — to approve a proposal (via POST /proposals/{id}/approve)

Role defaults (from ROLE_DEFAULT_PERMISSIONS):
  - viewer → {} (no write perms)
  - editor → {content:propose}
  - admin  → {content:propose, content:publish_direct, ...}

Task 29 — dashboard widget read RBAC
======================================
All five registered widgets require ``runs:read`` uniformly.  This is the
*chosen spec stance* per SP3.4 §2 row 17 ("no new permission slugs; runs:read
covers widgets that surface runs/results data").  ``review_backlog`` surfaces
proposal data, but Task 17's implementation applies ``runs:read`` to all five
widgets for uniformity and a single, simple rule.  This file locks that choice
by asserting ``runs:read`` for every widget — including ``review_backlog``.

If a future spec revision changes ``review_backlog`` to a different slug,
this test file is the single place to update.
"""

from __future__ import annotations

import hashlib
import secrets
import subprocess
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Module-level: mark all tests async
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hex() -> str:
    """8-char uppercase hex, safe for WombatID patterns."""
    return uuid.uuid4().hex[:8].upper()


def _remote_main_sha(remote) -> str:
    return subprocess.run(
        ["git", "-C", str(remote), "rev-parse", "main"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


async def _seed_plan(db_session: AsyncSession, project_id: uuid.UUID, wombat_id: str) -> None:
    """Insert a plan content row directly into the DB."""
    from wombat_api.database.models import Content

    body = {
        "title": "RBAC test plan",
        "description": "Seeded for RBAC tests",
        "include": {"tags_any": [], "tags_all": [], "components_any": [], "priorities": []},
        "exclude": {"tags_any": [], "tags_all": [], "components_any": [], "priorities": []},
        "suite_refs": [],
        "explicit_cases": {"add": [], "remove": []},
        "environments": [{"name": "staging", "config": {}}],
        "execution": "manual",
        "assignees": [],
        "approvals": [],
    }
    row = Content(
        project_id=project_id,
        kind="plan",
        wombat_id=wombat_id,
        title=body["title"],
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


async def _issue_api_token_with_perms(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    permissions: list[str] | None,
    publish_direct: bool = False,
) -> str:
    """Directly insert an API token row; return the raw ``wombat_`` token string.

    Uses the repository so the hash is stored and the token can be looked up by
    the auth layer.  This bypasses ``POST /tokens`` so we avoid the issuer-perm
    check — this lets us create tokens with *arbitrary* permission subsets,
    including no permissions at all (to test the 403 path).
    """
    from wombat_api.database.repository import Repository

    raw_token = f"wombat_{secrets.token_urlsafe(32)}"
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    repo = Repository(db_session)
    await repo.create_api_token(
        user_id=user_id,
        name=f"rbac-test-{uuid.uuid4().hex[:6]}",
        scopes=[],
        token_hash=token_hash,
        expires_at=None,
        publish_direct=publish_direct,
        purpose=None,
        permissions=permissions,
    )
    await db_session.commit()
    return raw_token


# ---------------------------------------------------------------------------
# SP3.4-specific fixture: two isolated projects (A and B) with the same users
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def two_projects(db_session: AsyncSession, users):
    """Create two projects and grant roles on project A only.

    Returns ``(project_a, slug_a, project_b, slug_b)``.
    The ``users`` fixture's users have roles on ``project_a``; they have no
    role on ``project_b``.  Cross-project writes to ``project_b`` must 403.
    """
    from wombat_api.database.models import ProjectDB, UserProjectRoleDB

    slug_a = f"proj-a-{uuid.uuid4().hex[:8]}"
    project_a = ProjectDB(
        slug=slug_a,
        name="Project A",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    slug_b = f"proj-b-{uuid.uuid4().hex[:8]}"
    project_b = ProjectDB(
        slug=slug_b,
        name="Project B",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project_a)
    db_session.add(project_b)
    await db_session.flush()

    for role_name in ("viewer", "editor", "admin"):
        db_session.add(
            UserProjectRoleDB(
                user_id=users[role_name]["user"].id,
                project_id=project_a.id,
                role=role_name,
            )
        )
    await db_session.commit()

    return project_a, slug_a, project_b, slug_b


# ===========================================================================
# Task 28 — plan/suite write RBAC
# ===========================================================================

# ---------------------------------------------------------------------------
# 28.1  viewer (no content:propose) → 403 on POST /proposals?kind=plan
# ---------------------------------------------------------------------------


async def test_viewer_cannot_propose_kind_plan_403(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """A viewer has no content:propose; submitting kind=plan returns 403.

    Permission slugs asserted: content:propose (absent).
    """
    _, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json={
            "kind": "plan",
            "source_path": f"plans/PLAN-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Viewer plan attempt",
            "proposed_body": {
                "title": "Viewer plan attempt",
                "include": {},
                "exclude": {},
                "explicit_cases": {"add": [], "remove": []},
                "suite_refs": [],
                "environments": [],
                "execution": "manual",
                "assignees": [],
                "approvals": [],
            },
        },
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, r.text
    err = r.json().get("error") or r.json().get("detail") or {}
    assert err.get("code") == "not_permitted"


# ---------------------------------------------------------------------------
# 28.2  viewer → 403 on POST /proposals?kind=suite
# ---------------------------------------------------------------------------


async def test_viewer_cannot_propose_kind_suite_403(
    httpx_client: AsyncClient,
    users,
    seeded_project,
):
    """A viewer has no content:propose; submitting kind=suite returns 403.

    Permission slugs asserted: content:propose (absent).
    """
    _, slug = seeded_project
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json={
            "kind": "suite",
            "source_path": f"suites/SUITE-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Viewer suite attempt",
            "proposed_body": {
                "title": "Viewer suite attempt",
                "description": "",
                "cases": [],
                "include": {},
                "owner": "@viewer",
                "tags": [],
            },
        },
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, r.text
    err = r.json().get("error") or r.json().get("detail") or {}
    assert err.get("code") == "not_permitted"


# ---------------------------------------------------------------------------
# 28.3  API token without content:propose → 403 on plan proposal
# ---------------------------------------------------------------------------


async def test_api_token_without_content_propose_cannot_create_plan_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    seeded_project,
):
    """An API token that carries only runs:read (not content:propose) is blocked.

    Permission slugs asserted: content:propose (absent from token permissions).
    """
    _, slug = seeded_project
    # Editor user, but token explicitly scoped to runs:read only.
    editor_user = users["editor"]["user"]
    raw_token = await _issue_api_token_with_perms(
        db_session, editor_user.id, permissions=["runs:read"]
    )

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json={
            "kind": "plan",
            "source_path": f"plans/PLAN-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Token plan attempt",
            "proposed_body": {
                "title": "Token plan attempt",
                "include": {},
                "exclude": {},
                "explicit_cases": {"add": [], "remove": []},
                "suite_refs": [],
                "environments": [],
                "execution": "manual",
                "assignees": [],
                "approvals": [],
            },
        },
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.4  API token without content:propose → 403 on suite proposal
# ---------------------------------------------------------------------------


async def test_api_token_without_content_propose_cannot_create_suite_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    seeded_project,
):
    """An API token without content:propose cannot submit kind=suite.

    Permission slugs asserted: content:propose (absent from token permissions).
    """
    _, slug = seeded_project
    editor_user = users["editor"]["user"]
    raw_token = await _issue_api_token_with_perms(
        db_session, editor_user.id, permissions=["runs:read"]
    )

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json={
            "kind": "suite",
            "source_path": f"suites/SUITE-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Token suite attempt",
            "proposed_body": {
                "title": "Token suite attempt",
                "description": "",
                "cases": [],
                "include": {},
                "owner": "@bot",
                "tags": [],
            },
        },
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.5  API token without content:propose → 403 on POST .../plans/{wid}/clone
# ---------------------------------------------------------------------------


async def test_api_token_without_content_propose_cannot_clone_plan_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    seeded_project,
):
    """POST /plans/{wid}/clone requires content:propose; a runs-only token is blocked.

    Permission slugs asserted: content:propose (absent from token permissions).
    """
    project, slug = seeded_project
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    editor_user = users["editor"]["user"]
    raw_token = await _issue_api_token_with_perms(
        db_session, editor_user.id, permissions=["runs:read"]
    )

    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": f"PLAN-{_hex()}"},
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.6  viewer → 403 on clone (mirrors 28.1 for the clone route)
# ---------------------------------------------------------------------------


async def test_viewer_cannot_clone_plan_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    seeded_project,
):
    """A viewer (no content:propose) cannot clone a plan.

    Permission slugs asserted: content:propose (absent for viewer role).
    """
    project, slug = seeded_project
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    viewer_token = users["viewer"]["token"]
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": f"PLAN-{_hex()}"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.7  editor cannot approve (no content:publish_direct)
# ---------------------------------------------------------------------------


async def test_editor_cannot_approve_plan_proposal_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    temp_git_project,
):
    """An editor has content:propose but not content:publish_direct.
    Calling POST /proposals/{id}/approve returns 403.

    The plan proposal is created via POST /plans/{wid}/clone (which calls
    repo.create_proposal with kind='plan' directly, bypassing the ProposalCreate
    Pydantic schema that currently restricts kind to testcase/shared_step/story —
    see implementation note below).

    Implementation note: SP3.4 routes plans/suites through the proposal flow at
    the service layer (clone, approve, etc.), but ``POST /proposals`` body schema
    (``ProposalCreate.kind``) was not updated to accept 'plan'/'suite' in the
    current SP3.4 wave.  Plan proposals created via the clone route DO appear in
    the proposals table with ``kind='plan'`` and are subject to the full approve
    permission check.  Tests that assert 403 on ``POST /proposals?kind=plan``
    (viewer tests 28.1/28.2) still work because the auth guard fires before body
    validation.  This test uses the clone route for the editor-creates path.

    Permission slugs asserted: content:publish_direct (absent for editor role).
    """
    project, _workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    # Grant both roles on the temp_git_project (users fixture seeds seeded_project).
    editor_user = users["editor"]["user"]
    admin_user = users["admin"]["user"]
    editor_token = users["editor"]["token"]

    for user, role_name in [(editor_user, "editor"), (admin_user, "admin")]:
        db_session.add(UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name))
    await db_session.commit()

    # Seed a source plan and use clone to create the proposal (kind='plan').
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, plan_wid)

    new_wid = f"PLAN-{_hex()}"
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{plan_wid}/clone",
        json={"new_wombat_id": new_wid, "title": "Editor clone for approve test"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 201, r.text
    proposal_id = r.json()["data"]["proposal"]["id"]

    # Create a second editor (different user) to avoid self-approval guard.
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    second_editor_email = f"second-editor-{uuid.uuid4().hex[:6]}@test.example"
    second_editor = UserDB(
        email=second_editor_email,
        hashed_password=hash_password("Test1234!"),
        display_name="Second Editor",
        is_active=True,
    )
    db_session.add(second_editor)
    await db_session.flush()
    db_session.add(
        UserProjectRoleDB(user_id=second_editor.id, project_id=project.id, role="editor")
    )
    await db_session.commit()
    second_editor_token = create_access_token(second_editor.id, second_editor_email)

    # Second editor attempts to approve → 403 (no content:publish_direct).
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "LGTM"},
        headers={"Authorization": f"Bearer {second_editor_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.8  Positive end-to-end: editor proposes plan, admin approves
#        (tests the full approve flow with content:publish_direct)
# ---------------------------------------------------------------------------


async def test_approve_flow_kind_plan_end_to_end(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    temp_git_project,
):
    """Editor proposes kind=plan via clone; admin (content:publish_direct) approves.

    Full positive-path end-to-end: plan proposal created via POST /plans/{wid}/clone
    (which creates a proposal with kind='plan'), then approved by admin.

    The clone route is used because ``POST /proposals`` currently restricts ``kind``
    to ``testcase|shared_step|story`` in the ``ProposalCreate`` schema.  The clone
    route calls ``repo.create_proposal`` directly with ``kind='plan'``, bypassing
    that restriction.  The resulting proposal has ``kind='plan'`` and flows through
    the same approve path.

    Permission slugs asserted:
    - content:propose  (present for editor — clone route enforces this)
    - content:publish_direct  (present for admin — approve route enforces this)
    """
    project, _workspace, remote = temp_git_project

    from wombat_api.database.models import UserProjectRoleDB

    editor_user = users["editor"]["user"]
    admin_user = users["admin"]["user"]
    editor_token = users["editor"]["token"]
    admin_token = users["admin"]["token"]

    for user, role_name in [(editor_user, "editor"), (admin_user, "admin")]:
        db_session.add(UserProjectRoleDB(user_id=user.id, project_id=project.id, role=role_name))
    await db_session.commit()

    # Seed a source plan to clone.
    src_plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project.id, src_plan_wid)

    # Editor clones → creates an open plan proposal.
    new_wid = f"PLAN-{_hex()}"
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/plans/{src_plan_wid}/clone",
        json={"new_wombat_id": new_wid, "title": "End-to-end plan"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 201, r.text
    proposal = r.json()["data"]["proposal"]
    assert proposal["kind"] == "plan"
    assert proposal["status"] == "open"
    proposal_id = proposal["id"]

    # Admin approves (has content:publish_direct by default).
    r = await httpx_client.post(
        f"/api/projects/{project.slug}/proposals/{proposal_id}/approve",
        json={"comment": "Plan approved"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["proposal"]["status"] == "published"
    assert data["published_sha"]


# ---------------------------------------------------------------------------
# 28.9  Cross-project write: viewer token scoped to project A → 403 on B
# ---------------------------------------------------------------------------


async def test_cross_project_write_viewer_403(
    httpx_client: AsyncClient,
    users,
    two_projects,
):
    """A viewer JWT authenticated against project A is blocked when writing to B.

    The viewer has no role on project B — the middleware must reject with 403.
    (viewer also has no content:propose, so the 403 is guaranteed on two grounds.)

    Permission slugs asserted: cross-project isolation (project membership check).
    """
    _project_a, _slug_a, _project_b, slug_b = two_projects
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug_b}/proposals",
        json={
            "kind": "plan",
            "source_path": f"plans/PLAN-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Cross-project viewer write",
            "proposed_body": {
                "title": "Cross-project viewer write",
                "include": {},
                "exclude": {},
                "explicit_cases": {"add": [], "remove": []},
                "suite_refs": [],
                "environments": [],
                "execution": "manual",
                "assignees": [],
                "approvals": [],
            },
        },
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.10 Cross-project write: editor token scoped to project A → 403 on B
# ---------------------------------------------------------------------------


async def test_cross_project_write_editor_403(
    httpx_client: AsyncClient,
    users,
    two_projects,
):
    """An editor JWT with content:propose on project A is blocked on project B.

    The editor has a role only on project A; project B has no membership.

    Permission slugs asserted: cross-project isolation (project membership check).
    """
    _project_a, _slug_a, _project_b, slug_b = two_projects
    editor_token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/projects/{slug_b}/proposals",
        json={
            "kind": "plan",
            "source_path": f"plans/PLAN-{_hex()}.md",
            "base_revision": "deadbeef" * 5,
            "proposed_title": "Cross-project editor write",
            "proposed_body": {
                "title": "Cross-project editor write",
                "include": {},
                "exclude": {},
                "explicit_cases": {"add": [], "remove": []},
                "suite_refs": [],
                "environments": [],
                "execution": "manual",
                "assignees": [],
                "approvals": [],
            },
        },
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.11 Cross-project clone: editor token scoped to project A → 403 on clone in B
# ---------------------------------------------------------------------------


async def test_cross_project_clone_editor_403(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    two_projects,
):
    """Editor who has content:propose on project A cannot clone a plan in project B.

    Even though project B has a plan (seeded directly), the cross-project
    membership check fires first and returns 403.
    """
    project_a, _slug_a, project_b, slug_b = two_projects
    editor_token = users["editor"]["token"]

    # Seed a plan in project B directly (bypassing auth).
    plan_wid = f"PLAN-{_hex()}"
    await _seed_plan(db_session, project_b.id, plan_wid)

    r = await httpx_client.post(
        f"/api/projects/{slug_b}/plans/{plan_wid}/clone",
        json={"new_wombat_id": f"PLAN-{_hex()}"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 28.12  Unauthenticated plan write → 401
# ---------------------------------------------------------------------------


async def test_unauthenticated_plan_clone_returns_401(
    httpx_client: AsyncClient,
    seeded_project,
):
    """POST /plans/{wid}/clone without any bearer token returns 401.

    This anchors the unauthenticated baseline: the auth layer fires before
    any permission or body check.  Mirrors similar tests in test_routes_plans.py
    but is included here for completeness of the RBAC matrix.
    """
    _, slug = seeded_project
    r = await httpx_client.post(
        f"/api/projects/{slug}/plans/PLAN-NOPE/clone",
        json={"new_wombat_id": "PLAN-CLONEZ"},
    )
    assert r.status_code in (401, 403), r.text


# ===========================================================================
# Task 29 — dashboard widget read RBAC
# ===========================================================================

# ---------------------------------------------------------------------------
# Fixture: project with users granted and one project the token can't access
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def widget_project(db_session: AsyncSession, users):
    """Create a fresh project and grant viewer/editor/admin to fixture users.

    Returns ``(project, slug)``.
    """
    from wombat_api.database.models import ProjectDB, UserProjectRoleDB

    slug = f"widget-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Widget RBAC Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project)
    await db_session.flush()

    for role_name in ("viewer", "editor", "admin"):
        db_session.add(
            UserProjectRoleDB(
                user_id=users[role_name]["user"].id,
                project_id=project.id,
                role=role_name,
            )
        )
    await db_session.commit()
    return project, slug


# ---------------------------------------------------------------------------
# 29.1–29.5  Each widget requires runs:read; token without it → 403
# ---------------------------------------------------------------------------

# ``review_backlog`` note: Task 17 of SP3.4 implemented all five widgets under
# a uniform ``runs:read`` guard (see dashboards/routes.py).  This matches the
# spec's "no new slugs; runs:read for all widgets that surface runs/results
# data" stance.  ``review_backlog`` surfaces proposal data but was deliberately
# kept under ``runs:read`` so users see a consistent permission model.  This
# is the chosen spec stance — if a future revision promotes ``review_backlog``
# to a different slug, update the parametrize list below.

WIDGET_SLUGS = [
    "passfail_trend",
    "recent_runs",
    "top_failing_cases",
    "release_readiness",
    "review_backlog",
]


@pytest.mark.parametrize("widget_slug", WIDGET_SLUGS)
async def test_widget_without_runs_read_returns_403(
    widget_slug: str,
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    widget_project,
):
    """A token explicitly stripped of runs:read is denied access to every widget.

    Permission slugs asserted: runs:read (absent from API token permissions).

    ``review_backlog`` is included here because SP3.4 Task 17 applies the
    uniform ``runs:read`` guard to all five widgets.  This test locks that
    decision and will fail (intentionally) if the implementation changes.
    """
    project, slug = widget_project
    # Viewer user, but token has an empty permissions list → no runs:read.
    viewer_user = users["viewer"]["user"]
    raw_token = await _issue_api_token_with_perms(
        db_session, viewer_user.id, permissions=[]
    )

    params = {"scope": "project", "scope_id": str(project.id)}
    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/{widget_slug}",
        params=params,
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert r.status_code == 403, (
        f"widget={widget_slug}: expected 403 for token without runs:read, "
        f"got {r.status_code}. Body: {r.text}"
    )


# ---------------------------------------------------------------------------
# 29.6–29.10  Positive: token with runs:read can fetch each widget (200)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("widget_slug", WIDGET_SLUGS)
async def test_widget_with_runs_read_returns_200(
    widget_slug: str,
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    widget_project,
):
    """A token with runs:read receives 200 (or a domain-valid 4xx) for each widget.

    Permission slugs asserted: runs:read (present).

    We accept 400 as a valid response for widgets like ``release_readiness``
    that require additional filters (plan_id) on project scope — the important
    thing is that auth passes (no 401/403).
    """
    project, slug = widget_project
    viewer_user = users["viewer"]["user"]
    raw_token = await _issue_api_token_with_perms(
        db_session, viewer_user.id, permissions=["runs:read"]
    )

    params = {"scope": "project", "scope_id": str(project.id)}
    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/{widget_slug}",
        params=params,
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    # 200 → success.  400 → domain error (e.g. missing plan_id for release_readiness)
    # but auth passed.  401/403 → failure.
    assert r.status_code in (200, 400), (
        f"widget={widget_slug}: expected 200 or 400 (auth passed), "
        f"got {r.status_code}. Body: {r.text}"
    )


# ---------------------------------------------------------------------------
# 29.11  Positive: viewer JWT (has runs:read via role default) can fetch widgets
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("widget_slug", ["passfail_trend", "recent_runs", "top_failing_cases"])
async def test_viewer_jwt_can_fetch_widget_200(
    widget_slug: str,
    httpx_client: AsyncClient,
    users,
    widget_project,
):
    """A viewer JWT has runs:read by role default; widgets return 200.

    Permission slugs asserted: runs:read (present via role default for viewer).
    """
    project, slug = widget_project
    viewer_token = users["viewer"]["token"]

    params = {"scope": "project", "scope_id": str(project.id)}
    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/{widget_slug}",
        params=params,
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# 29.12  Cross-project widget read: token scoped to A → 403 on B
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("widget_slug", ["passfail_trend", "recent_runs"])
async def test_cross_project_widget_read_403(
    widget_slug: str,
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    two_projects,
):
    """A viewer JWT with a role on project A is denied access to project B's widgets.

    The ``users`` fixture users have no role on project B (see two_projects fixture).
    The project membership check fires before the permission check.

    Permission slugs asserted: cross-project isolation (no role on B).
    """
    _project_a, _slug_a, project_b, slug_b = two_projects
    viewer_token = users["viewer"]["token"]

    params = {"scope": "project", "scope_id": str(project_b.id)}
    r = await httpx_client.get(
        f"/api/projects/{slug_b}/dashboards/widget/{widget_slug}",
        params=params,
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, (
        f"widget={widget_slug}: expected 403 for cross-project read, "
        f"got {r.status_code}. Body: {r.text}"
    )


# ---------------------------------------------------------------------------
# 29.13  Cross-project widget list: token scoped to A → 403 on B
# ---------------------------------------------------------------------------


async def test_cross_project_widget_list_403(
    httpx_client: AsyncClient,
    users,
    two_projects,
):
    """GET /dashboards/widgets on project B with a token only valid for A → 403.

    The list endpoint also requires runs:read + project membership.
    """
    _project_a, _slug_a, _project_b, slug_b = two_projects
    viewer_token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug_b}/dashboards/widgets",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# 29.14  review_backlog specifically: assert runs:read is enforced
#         (documents the chosen spec stance explicitly)
# ---------------------------------------------------------------------------


async def test_review_backlog_requires_runs_read_explicitly(
    httpx_client: AsyncClient,
    users,
    db_session: AsyncSession,
    widget_project,
):
    """Explicit single-widget test for review_backlog + runs:read.

    Spec stance (SP3.4 §2 row 17): no new permission slugs.  review_backlog
    surfaces proposals data, but the implementation deliberately reuses
    runs:read uniformly across all five widgets.  This avoids a split model
    where viewers could see run widgets but not the proposal backlog.

    If this test fails, it means Task 17's implementation diverged from the
    spec — do NOT change this test; fix the route instead.

    Permission slugs asserted: runs:read (absent → 403; present → not 403).
    """
    project, slug = widget_project

    viewer_user = users["viewer"]["user"]

    # Token without any permission (simulates a runs-read-stripped token).
    no_perms_token = await _issue_api_token_with_perms(
        db_session, viewer_user.id, permissions=[]
    )
    params = {"scope": "project", "scope_id": str(project.id)}

    r_deny = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/review_backlog",
        params=params,
        headers={"Authorization": f"Bearer {no_perms_token}"},
    )
    assert r_deny.status_code == 403, (
        f"review_backlog: expected 403 without runs:read, got {r_deny.status_code}. "
        f"Body: {r_deny.text}"
    )

    # Token with runs:read — auth passes (200 or domain-specific 4xx are both fine).
    runs_read_token = await _issue_api_token_with_perms(
        db_session, viewer_user.id, permissions=["runs:read"]
    )
    r_allow = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/review_backlog",
        params=params,
        headers={"Authorization": f"Bearer {runs_read_token}"},
    )
    assert r_allow.status_code in (200, 400), (
        f"review_backlog: expected 200 or 400 with runs:read, "
        f"got {r_allow.status_code}. Body: {r_allow.text}"
    )
