"""Integration tests for dashboard routes.

Covers:
  GET /api/projects/{slug}/dashboards/widgets
    - returns all 5 registered widgets
    - 401 without a token (auth required)

  GET /api/projects/{slug}/dashboards/widget/{slug}
    - 404 on unknown slug
    - 400 when scope not supported by widget (review_backlog + plan scope)
    - 400 when required filter missing (release_readiness on project scope with no plan_id)
    - 200 happy-path: passfail_trend on project scope returns {"points": [...]}
    - 401 without a token (auth required)

RBAC permission-matrix verification is deferred to Task 29 (auth-engineer).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Local helper: create a project + grant all three roles to the fixture users
# ---------------------------------------------------------------------------


async def _make_project(db_session: AsyncSession, users: dict) -> tuple:
    """Create a fresh project, grant viewer/editor/admin to test users.

    Returns (ProjectDB, slug).
    """
    from wombat_api.database.models import ProjectDB, UserProjectRoleDB

    slug = f"dash-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Dashboard Test Project",
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
# Tests: GET /api/projects/{slug}/dashboards/widgets
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_widgets_returns_all_five(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """All 5 registered widgets are returned by the list endpoint."""
    _, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widgets",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text

    body = r.json()
    assert "widgets" in body, body
    slugs = {w["slug"] for w in body["widgets"]}
    assert slugs == {
        "passfail_trend",
        "recent_runs",
        "top_failing_cases",
        "review_backlog",
        "release_readiness",
    }


@pytest.mark.asyncio
async def test_list_widgets_scope_kinds_is_sorted_list(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """scope_kinds must be a sorted list (JSON-serialisable, deterministic)."""
    _, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widgets",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text

    for widget in r.json()["widgets"]:
        sk = widget["scope_kinds"]
        assert isinstance(sk, list), f"scope_kinds should be list, got {type(sk)}"
        assert sk == sorted(sk), f"scope_kinds not sorted: {sk}"


@pytest.mark.asyncio
async def test_list_widgets_requires_auth(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Without a bearer token the endpoint returns 401."""
    _, slug = await _make_project(db_session, users)

    r = await httpx_client.get(f"/api/projects/{slug}/dashboards/widgets")
    assert r.status_code == 401, r.text


# ---------------------------------------------------------------------------
# Tests: GET /api/projects/{slug}/dashboards/widget/{slug}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_widget_unknown_slug_returns_404(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Requesting a widget slug that does not exist returns 404."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/nope",
        params={"scope": "project", "scope_id": str(project.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text
    error = r.json()["error"]
    assert error["code"] == "widget_not_found"


@pytest.mark.asyncio
async def test_release_readiness_project_scope_without_plan_id_returns_400(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """release_readiness on project scope without plan_id returns 400 mentioning plan_id."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/release_readiness",
        params={"scope": "project", "scope_id": str(project.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text
    error = r.json()["error"]
    assert error["code"] == "widget_missing_filter"
    # Error message and/or field must reference plan_id.
    assert "plan_id" in (error.get("message", "") + error.get("field", "")), error


@pytest.mark.asyncio
async def test_review_backlog_plan_scope_returns_400(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """review_backlog only supports project scope; plan scope returns 400."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/review_backlog",
        params={"scope": "plan", "scope_id": "PLAN-001"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text
    error = r.json()["error"]
    assert error["code"] == "widget_scope_not_supported"
    assert "review_backlog" in error["message"]
    assert "plan" in error["message"]


@pytest.mark.asyncio
async def test_passfail_trend_project_scope_returns_200_with_points(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """passfail_trend on project scope returns 200 with a 'points' key."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/passfail_trend",
        params={"scope": "project", "scope_id": str(project.id), "window": "7d"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "points" in body, body
    assert isinstance(body["points"], list)


@pytest.mark.asyncio
async def test_widget_dispatch_requires_auth(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Without a bearer token the dispatch endpoint returns 401."""
    project, slug = await _make_project(db_session, users)

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/passfail_trend",
        params={"scope": "project", "scope_id": str(project.id)},
    )
    assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_release_readiness_plan_scope_happy_path(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """release_readiness on plan scope does not need plan_id in filters (uses scope_id)."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    # Use a non-existent plan wombat_id; the widget returns an empty response
    # rather than 404 (per widget spec: "return zero-valued response for unknown plan").
    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/release_readiness",
        params={"scope": "plan", "scope_id": "PLAN-NONEXISTENT"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Widget returns empty response shape for unknown plan.
    assert "plan_id" in body
    assert "executed_pct" in body


@pytest.mark.asyncio
async def test_recent_runs_project_scope_returns_runs_key(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """recent_runs returns a dict with a 'runs' list."""
    project, slug = await _make_project(db_session, users)
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        f"/api/projects/{slug}/dashboards/widget/recent_runs",
        params={"scope": "project", "scope_id": str(project.id)},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "runs" in body
    assert isinstance(body["runs"], list)


@pytest.mark.asyncio
async def test_unknown_project_returns_404(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Requesting widgets for a project slug that does not exist returns 404."""
    token = users["viewer"]["token"]

    r = await httpx_client.get(
        "/api/projects/no-such-project-xyz/dashboards/widgets",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text
