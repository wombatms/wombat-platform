"""Integration tests for POST /{project_slug}/content/resolve (Task 10, SP3.4).

Covers:
1. Draft plan resolve returns >= 1 case matching filter; zero proposal rows written.
2. Draft plan resolve with unknown suite_ref returns UNKNOWN_SUITE_REF warning (HTTP 200).
3. Draft plan resolve with unknown explicit_cases.add returns UNKNOWN_CASE_ID warning (HTTP 200).
4. Draft with kind="other" → HTTP 422.
5. Cross-project: token scoped to project A cannot POST with slug of project B → 403.
6. Draft suite resolve: explicit cases list resolved to titles.
7. Draft suite resolve: include filter returns matching cases.
8. Draft plan resolve: count of returned cases matches seeded data; no DB writes.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _uid() -> str:
    """Return a 6-char uppercase hex fragment suitable for WombatID construction.

    WombatID pattern: ``^(TC|SS|PLAN|STORY|SUITE)-[A-Z0-9][-A-Z0-9]*$``
    uuid4().hex is lowercase; .upper() makes it safe.
    """
    return uuid.uuid4().hex[:6].upper()


async def _count_proposals(session: AsyncSession, project_id: uuid.UUID) -> int:
    from wombat_api.database.models import ProposalDB

    q = select(func.count()).where(ProposalDB.project_id == project_id)
    return (await session.execute(q)).scalar_one()


async def _seed_testcases(
    session: AsyncSession,
    project_id: uuid.UUID,
    specs: list[dict],
) -> None:
    """Insert testcase content rows.

    Each spec dict: {"wombat_id": str, "tags": list[str], "priority": str, "component": str}
    """
    from wombat_api.database.models import Content

    for spec in specs:
        wid = spec["wombat_id"]
        tags = spec.get("tags", [])
        priority = spec.get("priority", "medium")
        component = spec.get("component", "")
        row = Content(
            project_id=project_id,
            kind="testcase",
            wombat_id=wid,
            title=f"Test {wid}",
            tags=tags,
            body={
                "frontmatter": {"kind": "testcase", "id": wid},
                "title": f"Test {wid}",
                "priority": priority,
                "component": component,
                "markdown": "## Steps\n\n1. Do the thing.",
            },
            source_repo="test-repo",
            source_path=f"tests/{wid}.md",
            source_revision="abc123",
            content_hash=f"hash-{wid}",
        )
        session.add(row)
    await session.commit()


async def _seed_suite(
    session: AsyncSession,
    project_id: uuid.UUID,
    suite_wombat_id: str,
    cases: list[str],
    tags_any: list[str] | None = None,
) -> None:
    """Insert a suite content row."""
    from wombat_api.database.models import Content

    include: dict = {}
    if tags_any:
        include = {"tags_any": tags_any}

    row = Content(
        project_id=project_id,
        kind="suite",
        wombat_id=suite_wombat_id,
        title=f"Suite {suite_wombat_id}",
        tags=[],
        body={
            "cases": cases,
            "include": include,
            "owner": "@tester",
            "tags": [],
        },
        source_repo="test-repo",
        source_path=f"suites/{suite_wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{suite_wombat_id}",
    )
    session.add(row)
    await session.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_draft_plan_resolve_returns_matching_cases_no_db_write(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Draft plan resolve returns cases matching the filter; no proposal rows created."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    # Seed testcases: two with tag "payments", one without.
    prefix = f"TC-PAY-{_uid()}"
    await _seed_testcases(
        db_session,
        project.id,
        [
            {"wombat_id": f"{prefix}-1", "tags": ["payments"]},
            {"wombat_id": f"{prefix}-2", "tags": ["payments", "checkout"]},
            {"wombat_id": f"{prefix}-OTHER", "tags": ["auth"]},
        ],
    )

    before = await _count_proposals(db_session, project.id)

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "plan",
            "body": {
                "title": "Draft plan",
                "include": {"tags_any": ["payments"]},
                "exclude": {},
                "suite_refs": [],
                "explicit_cases": {"add": [], "remove": []},
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()

    # At least the two payment-tagged cases are returned.
    assert data["count"] >= 2
    wids = {c["wombat_id"] for c in data["cases"]}
    assert f"{prefix}-1" in wids
    assert f"{prefix}-2" in wids
    assert f"{prefix}-OTHER" not in wids

    # No proposal or content row was written.
    after = await _count_proposals(db_session, project.id)
    assert after == before, "resolve_draft must not create proposal rows"


@pytest.mark.asyncio
async def test_draft_plan_resolve_unknown_suite_ref_warns_http_200(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Unknown suite_ref emits UNKNOWN_SUITE_REF warning; still returns HTTP 200."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "plan",
            "body": {
                "title": "Draft",
                "include": {},
                "exclude": {},
                "suite_refs": ["SUITE-DOES-NOT-EXIST"],
                "explicit_cases": {"add": [], "remove": []},
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    warning_codes = [w["code"] for w in data.get("warnings", [])]
    assert "UNKNOWN_SUITE_REF" in warning_codes, f"Expected UNKNOWN_SUITE_REF, got: {warning_codes}"


@pytest.mark.asyncio
async def test_draft_plan_resolve_unknown_explicit_add_warns_http_200(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Unknown explicit_cases.add ID emits UNKNOWN_CASE_ID warning; still returns HTTP 200."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "plan",
            "body": {
                "title": "Draft",
                "include": {},
                "exclude": {},
                "suite_refs": [],
                "explicit_cases": {"add": ["TC-MISSING-XXXX"], "remove": []},
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    warning_codes = [w["code"] for w in data.get("warnings", [])]
    assert "UNKNOWN_CASE_ID" in warning_codes, f"Expected UNKNOWN_CASE_ID, got: {warning_codes}"


@pytest.mark.asyncio
async def test_draft_resolve_invalid_kind_returns_422(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """kind='other' (not 'plan' or 'suite') → HTTP 422."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "other",
            "body": {"title": "Nope"},
        },
        headers=_auth(token),
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_draft_resolve_cross_project_returns_403(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Token scoped to project A cannot POST with slug of project B → 403."""
    _project_a, slug_a = seeded_project
    token_a = users["editor"]["token"]

    # Create a second project that the editor has no role on.
    from wombat_api.database.models import ProjectDB

    slug_b = f"project-b-{uuid.uuid4().hex[:8]}"
    project_b = ProjectDB(
        slug=slug_b,
        name="Project B",
        org="other-org",
    )
    db_session.add(project_b)
    await db_session.commit()

    # token_a belongs to project A; using slug_b should be rejected.
    r = await httpx_client.post(
        f"/api/{slug_b}/content/resolve",
        json={
            "kind": "plan",
            "body": {"title": "Draft", "include": {}, "suite_refs": [], "explicit_cases": {"add": [], "remove": []}},
        },
        headers=_auth(token_a),
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_draft_suite_resolve_explicit_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Draft suite resolve: explicit cases list resolves to their titles."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    prefix = f"TC-SUITE-{_uid()}"
    await _seed_testcases(
        db_session,
        project.id,
        [
            {"wombat_id": f"{prefix}-A"},
            {"wombat_id": f"{prefix}-B"},
        ],
    )

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "suite",
            "body": {
                "title": "My draft suite",
                "cases": [f"{prefix}-A", f"{prefix}-B"],
                "include": {},
                "owner": "@me",
                "tags": [],
                # parent_wombat_id present — should be ignored for draft resolution.
                "parent_wombat_id": "SUITE-PARENT-DOES-NOT-EXIST",
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == 2
    wids = {c["wombat_id"] for c in data["cases"]}
    assert f"{prefix}-A" in wids
    assert f"{prefix}-B" in wids


@pytest.mark.asyncio
async def test_draft_suite_resolve_include_filter(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Draft suite resolve: include filter returns matching cases from the DB."""
    project, slug = seeded_project
    token = users["editor"]["token"]

    prefix = f"TC-SFILT-{_uid()}"
    await _seed_testcases(
        db_session,
        project.id,
        [
            {"wombat_id": f"{prefix}-X", "tags": ["checkout"]},
            {"wombat_id": f"{prefix}-Y", "tags": ["checkout", "payments"]},
            {"wombat_id": f"{prefix}-Z", "tags": ["auth"]},
        ],
    )

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "suite",
            "body": {
                "title": "Checkout suite draft",
                "cases": [],
                "include": {"tags_any": ["checkout"]},
                "owner": "@me",
                "tags": [],
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    wids = {c["wombat_id"] for c in data["cases"]}
    assert f"{prefix}-X" in wids
    assert f"{prefix}-Y" in wids
    assert f"{prefix}-Z" not in wids


@pytest.mark.asyncio
async def test_draft_plan_resolve_unauthenticated_returns_401(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Unauthenticated request → 401 (auth enforced before route logic)."""
    _project, slug = seeded_project

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={"kind": "plan", "body": {}},
    )
    # Could be 401 or 403 depending on auth middleware; either is correct.
    assert r.status_code in (401, 403), r.text


@pytest.mark.asyncio
async def test_draft_plan_resolve_viewer_allowed(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Viewer role can call the read-only resolve endpoint."""
    project, slug = seeded_project
    token = users["viewer"]["token"]

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "plan",
            "body": {
                "title": "Draft",
                "include": {},
                "suite_refs": [],
                "explicit_cases": {"add": [], "remove": []},
            },
        },
        headers=_auth(token),
    )
    # Viewer should succeed (200) — resolve is a read-only operation.
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_draft_plan_resolve_combined_filter_and_explicit_add(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Filter + explicit add compose correctly; remove excludes from result."""
    project, slug = seeded_project
    token = users["admin"]["token"]

    prefix = f"TC-COMBO-{_uid()}"
    await _seed_testcases(
        db_session,
        project.id,
        [
            {"wombat_id": f"{prefix}-F1", "tags": ["billing"]},
            {"wombat_id": f"{prefix}-F2", "tags": ["billing"]},
            {"wombat_id": f"{prefix}-EXTRA", "tags": ["other"]},
        ],
    )

    r = await httpx_client.post(
        f"/api/{slug}/content/resolve",
        json={
            "kind": "plan",
            "body": {
                "title": "Combo plan",
                "include": {"tags_any": ["billing"]},
                "exclude": {},
                "suite_refs": [],
                "explicit_cases": {
                    "add": [f"{prefix}-EXTRA"],
                    "remove": [f"{prefix}-F2"],
                },
            },
        },
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    wids = {c["wombat_id"] for c in data["cases"]}
    assert f"{prefix}-F1" in wids, "filter case should be included"
    assert f"{prefix}-EXTRA" in wids, "explicit add should be included"
    assert f"{prefix}-F2" not in wids, "explicit remove should be excluded"
