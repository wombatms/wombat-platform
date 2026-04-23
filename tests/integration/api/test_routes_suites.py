"""Integration tests for SP3.4 suite route extensions: tree and resolve.

Task 9 — Suites route extensions.
Happy-path + auth rejection for each of the two new endpoints.
Edge cases (cycle prevention, cross-project) are deferred to Task 22.
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


async def _seed_suite(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    *,
    parent_wombat_id: str | None = None,
    cases: list[str] | None = None,
    title: str | None = None,
) -> None:
    """Insert a suite content row directly into the DB."""
    from wombat_api.database.models import Content

    body: dict = {
        "title": title or f"Suite {wombat_id}",
        "description": "",
        "cases": cases or [],
        "include": {},
        "owner": "@qa-team",
        "tags": [],
    }
    if parent_wombat_id is not None:
        body["parent_wombat_id"] = parent_wombat_id

    row = Content(
        project_id=project_id,
        kind="suite",
        wombat_id=wombat_id,
        title=body["title"],
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"suites/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    await db_session.commit()


async def _seed_testcase(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
) -> None:
    """Insert a testcase content row directly into the DB."""
    from wombat_api.database.models import Content

    row = Content(
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Case {wombat_id}",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "id": wombat_id}, "markdown": "steps"},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    await db_session.commit()


# ---------------------------------------------------------------------------
# GET /{project_slug}/suites/tree
# ---------------------------------------------------------------------------


async def test_suite_tree_empty(
    httpx_client: AsyncClient,
    seeded_project,
    users,
):
    """Tree endpoint on a project with no suites returns an empty nodes list."""
    _, slug = seeded_project
    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/tree",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "nodes" in body
    assert body["nodes"] == []


async def test_suite_tree_root_nodes(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Root suites (no parent) appear with parent_wombat_id=null."""
    project, slug = seeded_project
    suffix = _hex()
    root_a = f"SUITE-A{suffix}"
    root_b = f"SUITE-B{suffix}"
    await _seed_suite(db_session, project.id, root_a, title="Root A")
    await _seed_suite(db_session, project.id, root_b, title="Root B")

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/tree",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    nodes = r.json()["nodes"]
    node_ids = {n["wombat_id"] for n in nodes}
    assert root_a in node_ids
    assert root_b in node_ids
    for node in nodes:
        if node["wombat_id"] in (root_a, root_b):
            assert node["parent_wombat_id"] is None, (
                f"Expected null parent for {node['wombat_id']}, got {node['parent_wombat_id']}"
            )


async def test_suite_tree_parent_child(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Child suite appears with parent_wombat_id set to its parent's wombat_id."""
    project, slug = seeded_project
    suffix = _hex()
    parent_wid = f"SUITE-P{suffix}"
    child_wid = f"SUITE-C{suffix}"
    await _seed_suite(db_session, project.id, parent_wid, title="Parent suite")
    await _seed_suite(db_session, project.id, child_wid, parent_wombat_id=parent_wid, title="Child suite")

    token = users["editor"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/tree",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    nodes = {n["wombat_id"]: n for n in r.json()["nodes"]}
    assert parent_wid in nodes
    assert child_wid in nodes
    assert nodes[child_wid]["parent_wombat_id"] == parent_wid
    assert nodes[parent_wid]["parent_wombat_id"] is None


async def test_suite_tree_node_shape(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Each node exposes exactly wombat_id, title, parent_wombat_id."""
    project, slug = seeded_project
    wid = f"SUITE-{_hex()}"
    await _seed_suite(db_session, project.id, wid, title="Shape test")

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/tree",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    nodes = {n["wombat_id"]: n for n in r.json()["nodes"]}
    assert wid in nodes
    node = nodes[wid]
    assert set(node.keys()) == {"wombat_id", "title", "parent_wombat_id"}
    assert node["title"] == "Shape test"


async def test_suite_tree_unauthenticated(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Tree without a token returns 401/403."""
    _, slug = seeded_project
    r = await httpx_client.get(f"/api/projects/{slug}/suites/tree")
    assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# GET /{project_slug}/suites/{wombat_id}/resolve
# ---------------------------------------------------------------------------


async def test_resolve_suite_empty(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Resolve a suite with no cases returns count=0."""
    project, slug = seeded_project
    wid = f"SUITE-{_hex()}"
    await _seed_suite(db_session, project.id, wid)

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{wid}/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["count"] == 0
    assert data["cases"] == []
    assert isinstance(data["warnings"], list)


async def test_resolve_suite_with_explicit_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Resolve a suite that references testcases via its cases field."""
    project, slug = seeded_project
    suffix = _hex()
    tc_wid = f"TC-{suffix}"
    await _seed_testcase(db_session, project.id, tc_wid)

    suite_wid = f"SUITE-{suffix}"
    await _seed_suite(db_session, project.id, suite_wid, cases=[tc_wid])

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{suite_wid}/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["count"] == 1
    assert data["cases"][0]["wombat_id"] == tc_wid
    assert f"suite_ref:{suite_wid}" in data["cases"][0]["source"]


async def test_resolve_suite_subtree(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """Resolve a parent suite includes cases from a child suite."""
    project, slug = seeded_project
    suffix = _hex()

    tc_parent = f"TC-P{suffix}"
    tc_child = f"TC-C{suffix}"
    for tc_wid in (tc_parent, tc_child):
        await _seed_testcase(db_session, project.id, tc_wid)

    parent_wid = f"SUITE-P{suffix}"
    child_wid = f"SUITE-C{suffix}"
    await _seed_suite(db_session, project.id, parent_wid, cases=[tc_parent])
    await _seed_suite(db_session, project.id, child_wid, parent_wombat_id=parent_wid, cases=[tc_child])

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{parent_wid}/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    resolved_ids = {c["wombat_id"] for c in data["cases"]}
    assert tc_parent in resolved_ids
    assert tc_child in resolved_ids
    assert data["count"] == 2


async def test_resolve_suite_not_found(
    httpx_client: AsyncClient,
    seeded_project,
    users,
):
    """Resolving a non-existent suite returns 404."""
    _, slug = seeded_project
    token = users["editor"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/SUITE-DOESNOTEXIST/resolve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


async def test_resolve_suite_unauthenticated(
    httpx_client: AsyncClient,
    seeded_project,
):
    """Resolve without a token returns 401/403."""
    _, slug = seeded_project
    r = await httpx_client.get(f"/api/projects/{slug}/suites/SUITE-X/resolve")
    assert r.status_code in (401, 403)
