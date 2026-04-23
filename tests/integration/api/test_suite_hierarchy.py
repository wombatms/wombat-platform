"""Integration tests for suite hierarchy semantics (SP3.4 Task 21).

Covers:
1. Tree depths 2, 3, and 5: resolve_suite returns the union of ALL descendant cases.
2. Cycle prevention on write: POST /proposals with kind=suite whose parent chain leads
   back to itself → 422 with code=SUITE_CYCLE.
3. Self-parent: parent_wombat_id == own id → 422 with code=SUITE_CYCLE.
4. Cross-project parent: parent_wombat_id pointing to a suite in another project
   → 422 with code=SUITE_PARENT_OTHER_PROJECT.
5. Leaf termination: resolve_suite on a leaf suite returns only its own cases.
6. DepthLimitError raised at depth > 20 (exercised via _resolve_suite directly).

On-write validation lives in ``routes/proposals.py::_validate_suite_proposal``,
added in the Task 21 implementation alongside these tests.
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
    return uuid.uuid4().hex[:8].upper()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seed_testcase(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
) -> None:
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
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()


async def _seed_suite(
    db_session: AsyncSession,
    project_id: uuid.UUID,
    wombat_id: str,
    *,
    parent_wombat_id: str | None = None,
    cases: list[str] | None = None,
) -> None:
    from wombat_api.database.models import Content

    body: dict = {
        "id": wombat_id,
        "title": f"Suite {wombat_id}",
        "cases": cases or [],
        "include": {},
        "owner": "@qa",
        "tags": [],
    }
    if parent_wombat_id is not None:
        body["parent_wombat_id"] = parent_wombat_id

    row = Content(
        project_id=project_id,
        kind="suite",
        wombat_id=wombat_id,
        title=f"Suite {wombat_id}",
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"suites/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()


async def _make_second_project(db_session: AsyncSession) -> tuple:
    """Create a second project with no roles; return (project, slug)."""
    from wombat_api.database.models import ProjectDB

    slug = f"other-proj-{uuid.uuid4().hex[:8]}"
    proj = ProjectDB(
        slug=slug,
        name="Other Project",
        org="other-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(proj)
    await db_session.flush()
    return proj, slug


def _suite_proposal_body(
    wombat_id: str,
    parent_wombat_id: str | None = None,
) -> dict:
    """Build a minimal suite proposal payload."""
    body: dict = {
        "id": wombat_id,
        "title": f"Suite {wombat_id}",
        "cases": [],
        "include": {},
        "owner": "@qa",
        "tags": [],
    }
    if parent_wombat_id is not None:
        body["parent_wombat_id"] = parent_wombat_id
    return {
        "kind": "suite",
        "source_path": f"suites/{wombat_id}.md",
        "base_revision": "abc123",
        "proposed_title": f"Suite {wombat_id}",
        "proposed_body": body,
        "proposal_action": "upsert",
        "summary": "test suite",
    }


# ---------------------------------------------------------------------------
# 1. Depth-2 hierarchy
# ---------------------------------------------------------------------------


async def test_depth2_resolves_all_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A 2-level suite hierarchy: parent + child both contribute cases."""
    project, slug = seeded_project
    suffix = _hex()

    tc_parent = f"TC-P{suffix}"
    tc_child = f"TC-C{suffix}"
    await _seed_testcase(db_session, project.id, tc_parent)
    await _seed_testcase(db_session, project.id, tc_child)
    await db_session.commit()

    root_wid = f"SUITE-ROOT-{suffix}"
    child_wid = f"SUITE-CHILD-{suffix}"
    await _seed_suite(db_session, project.id, root_wid, cases=[tc_parent])
    await _seed_suite(db_session, project.id, child_wid, parent_wombat_id=root_wid, cases=[tc_child])
    await db_session.commit()

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{root_wid}/resolve",
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    resolved_ids = {c["wombat_id"] for c in data["cases"]}
    assert tc_parent in resolved_ids
    assert tc_child in resolved_ids
    assert data["count"] == 2


# ---------------------------------------------------------------------------
# 2. Depth-3 hierarchy
# ---------------------------------------------------------------------------


async def test_depth3_resolves_all_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A 3-level suite hierarchy: root, child, grandchild all contribute cases."""
    project, slug = seeded_project
    suffix = _hex()

    tcs = [f"TC-L{i}-{suffix}" for i in range(1, 4)]
    for tc in tcs:
        await _seed_testcase(db_session, project.id, tc)
    await db_session.commit()

    root_wid = f"SUITE-ROOT3-{suffix}"
    child_wid = f"SUITE-CHILD3-{suffix}"
    grand_wid = f"SUITE-GRAND3-{suffix}"

    await _seed_suite(db_session, project.id, root_wid, cases=[tcs[0]])
    await _seed_suite(db_session, project.id, child_wid, parent_wombat_id=root_wid, cases=[tcs[1]])
    await _seed_suite(db_session, project.id, grand_wid, parent_wombat_id=child_wid, cases=[tcs[2]])
    await db_session.commit()

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{root_wid}/resolve",
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    resolved_ids = {c["wombat_id"] for c in data["cases"]}
    for tc in tcs:
        assert tc in resolved_ids, f"{tc} missing from 3-level resolution"
    assert data["count"] == 3


# ---------------------------------------------------------------------------
# 3. Depth-5 hierarchy
# ---------------------------------------------------------------------------


async def test_depth5_resolves_all_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A 5-level suite hierarchy: all 5 layers' cases are returned."""
    project, slug = seeded_project
    suffix = _hex()

    tcs = [f"TC-LV{i}-{suffix}" for i in range(1, 6)]
    for tc in tcs:
        await _seed_testcase(db_session, project.id, tc)
    await db_session.commit()

    # Build level-by-level; each level references the previous as parent.
    suite_ids = [f"SUITE-L{i}-{suffix}" for i in range(1, 6)]
    await _seed_suite(db_session, project.id, suite_ids[0], cases=[tcs[0]])
    for i in range(1, 5):
        await _seed_suite(
            db_session,
            project.id,
            suite_ids[i],
            parent_wombat_id=suite_ids[i - 1],
            cases=[tcs[i]],
        )
    await db_session.commit()

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{suite_ids[0]}/resolve",
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    resolved_ids = {c["wombat_id"] for c in data["cases"]}
    for tc in tcs:
        assert tc in resolved_ids, f"{tc} missing from 5-level resolution"
    assert data["count"] == 5


# ---------------------------------------------------------------------------
# 4. Leaf termination
# ---------------------------------------------------------------------------


async def test_leaf_suite_returns_only_own_cases(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A leaf suite (no children) returns exactly its own explicit cases."""
    project, slug = seeded_project
    suffix = _hex()

    tc1 = f"TC-LEAF1-{suffix}"
    tc2 = f"TC-LEAF2-{suffix}"
    await _seed_testcase(db_session, project.id, tc1)
    await _seed_testcase(db_session, project.id, tc2)
    await db_session.commit()

    leaf_wid = f"SUITE-LEAF-{suffix}"
    await _seed_suite(db_session, project.id, leaf_wid, cases=[tc1, tc2])
    await db_session.commit()

    token = users["viewer"]["token"]
    r = await httpx_client.get(
        f"/api/projects/{slug}/suites/{leaf_wid}/resolve",
        headers=_auth(token),
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    resolved_ids = {c["wombat_id"] for c in data["cases"]}
    assert resolved_ids == {tc1, tc2}
    assert data["count"] == 2


# ---------------------------------------------------------------------------
# 5. On-write cycle prevention — POST /proposals with kind=suite
# ---------------------------------------------------------------------------


async def test_suite_self_parent_rejected_on_write(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A suite that is its own parent (self-cycle) is rejected with 422 SUITE_CYCLE."""
    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    wid = f"SUITE-SELFP-{_hex()}"
    payload = _suite_proposal_body(wid, parent_wombat_id=wid)

    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=payload,
        headers=_auth(editor_token),
    )
    assert r.status_code == 422, r.text
    detail = r.json().get("detail") or r.json()
    # The error code must be SUITE_CYCLE
    assert _find_code(detail, "SUITE_CYCLE"), f"Expected SUITE_CYCLE in: {detail}"


async def test_suite_cycle_through_existing_parent_rejected(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A suite whose parent chain leads back to it is rejected with 422 SUITE_CYCLE.

    Hierarchy: SUITE-A → SUITE-B → SUITE-A (cycle).
    When we propose SUITE-A with parent=SUITE-B, and SUITE-B already has
    parent=SUITE-A in the DB, the write must be rejected.
    """
    project, slug = seeded_project
    suffix = _hex()

    suite_a_wid = f"SUITE-A-{suffix}"
    suite_b_wid = f"SUITE-B-{suffix}"

    # Seed SUITE-B with parent=SUITE-A (the to-be-proposed suite).
    await _seed_suite(db_session, project.id, suite_b_wid, parent_wombat_id=suite_a_wid)
    await db_session.commit()

    editor_token = users["editor"]["token"]

    # Now propose SUITE-A with parent=SUITE-B → cycle: A→B→A.
    payload = _suite_proposal_body(suite_a_wid, parent_wombat_id=suite_b_wid)
    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=payload,
        headers=_auth(editor_token),
    )
    assert r.status_code == 422, r.text
    detail = r.json().get("detail") or r.json()
    assert _find_code(detail, "SUITE_CYCLE"), f"Expected SUITE_CYCLE in: {detail}"


# ---------------------------------------------------------------------------
# 6. On-write cross-project parent rejection
# ---------------------------------------------------------------------------


async def test_suite_cross_project_parent_rejected_on_write(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    seeded_project,
    users,
):
    """A suite whose parent belongs to another project is rejected with 422."""
    project, slug = seeded_project
    other_proj, _other_slug = await _make_second_project(db_session)
    await db_session.commit()

    # Seed a suite in the OTHER project.
    other_suite_wid = f"SUITE-OTHER-{_hex()}"
    await _seed_suite(db_session, other_proj.id, other_suite_wid)
    await db_session.commit()

    editor_token = users["editor"]["token"]

    # Propose a suite in project A with parent pointing to other project's suite.
    new_wid = f"SUITE-CROSS-{_hex()}"
    payload = _suite_proposal_body(new_wid, parent_wombat_id=other_suite_wid)
    r = await httpx_client.post(
        f"/api/projects/{slug}/proposals",
        json=payload,
        headers=_auth(editor_token),
    )
    assert r.status_code == 422, r.text
    detail = r.json().get("detail") or r.json()
    assert _find_code(detail, "SUITE_PARENT_OTHER_PROJECT"), (
        f"Expected SUITE_PARENT_OTHER_PROJECT in: {detail}"
    )


# ---------------------------------------------------------------------------
# 7. DepthLimitError raised at depth > 20
# ---------------------------------------------------------------------------


async def test_depth_limit_error_raised_directly(
    db_session: AsyncSession,
    seeded_project,
):
    """_resolve_suite raises DepthLimitError when depth > 20.

    Exercised directly (no HTTP) to avoid building 21-level deep fixture.
    """
    from wombat_api.database.repository import Repository
    from wombat_api.planning.service import DepthLimitError, ResolveService

    project, _slug = seeded_project
    repo = Repository(db_session)
    svc = ResolveService(repo)

    with pytest.raises(DepthLimitError) as exc_info:
        await svc._resolve_suite(project.id, "SUITE-DEEP", [], depth=21)

    assert exc_info.value.wombat_id == "SUITE-DEEP"


async def test_depth_limit_error_at_exactly_21(
    db_session: AsyncSession,
    seeded_project,
):
    """depth=21 triggers the error; depth=20 does not (depth=20 is allowed)."""
    from wombat_api.database.repository import Repository
    from wombat_api.planning.service import DepthLimitError, ResolveService

    project, _slug = seeded_project
    repo = Repository(db_session)
    svc = ResolveService(repo)

    # depth=20 must NOT raise (returns empty set + UNKNOWN_SUITE_REF warning).
    warnings: list = []
    result = await svc._resolve_suite(project.id, "SUITE-NOTEXIST", warnings, depth=20)
    assert result == set()
    assert any(w.code == "UNKNOWN_SUITE_REF" for w in warnings)

    # depth=21 MUST raise.
    with pytest.raises(DepthLimitError):
        await svc._resolve_suite(project.id, "SUITE-NOTEXIST", [], depth=21)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def _find_code(detail, code: str) -> bool:
    """Return True if *code* appears in the error detail (dict or list)."""
    if isinstance(detail, dict):
        if detail.get("code") == code:
            return True
        for v in detail.values():
            if _find_code(v, code):
                return True
    if isinstance(detail, list):
        for item in detail:
            if _find_code(item, code):
                return True
    return False
