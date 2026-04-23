"""Repository tests for SP3.4 content helpers.

Covers:

* ``list_suite_subtree`` — recursive CTE on Postgres, Python BFS on SQLite.
  Three-level chain, leaf termination, depth cap, cross-project isolation.
* ``get_content_by_wombat_ids`` — batch fetch scoped to a project; unknown
  IDs are silently skipped.
"""

from __future__ import annotations

import uuid

import pytest_asyncio

from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository


async def _make_suite(
    db_session,
    project: ProjectDB,
    wombat_id: str,
    parent: str | None = None,
    title: str | None = None,
) -> Content:
    body: dict = {"id": wombat_id, "title": title or wombat_id, "owner": "qa"}
    if parent is not None:
        body["parent_wombat_id"] = parent
    row = Content(
        id=uuid.uuid4(),
        project_id=project.id,
        kind="suite",
        wombat_id=wombat_id,
        title=title or wombat_id,
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"suites/{wombat_id}.yml",
        source_revision="rev-1",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _make_testcase(db_session, project: ProjectDB, wombat_id: str) -> Content:
    row = Content(
        id=uuid.uuid4(),
        project_id=project.id,
        kind="testcase",
        wombat_id=wombat_id,
        title=wombat_id,
        tags=[],
        body={"id": wombat_id, "title": wombat_id},
        source_repo="test-repo",
        source_path=f"cases/{wombat_id}.md",
        source_revision="rev-1",
        content_hash=f"hash-{wombat_id}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


@pytest_asyncio.fixture
async def second_project(db_session) -> ProjectDB:
    project = ProjectDB(
        id=uuid.uuid4(),
        slug="other-proj",
        name="Other Project",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project)
    await db_session.flush()
    return project


# ---------------------------------------------------------------------------
# list_suite_subtree
# ---------------------------------------------------------------------------


async def test_suite_subtree_three_levels(db_session, sample_project):
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    await _make_suite(db_session, sample_project, "SUITE-B", parent="SUITE-A")
    await _make_suite(db_session, sample_project, "SUITE-C", parent="SUITE-B")
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A")
    assert {s.wombat_id for s in subtree} == {"SUITE-A", "SUITE-B", "SUITE-C"}


async def test_suite_subtree_terminates_on_leaf(db_session, sample_project):
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A")
    assert [s.wombat_id for s in subtree] == ["SUITE-A"]


async def test_suite_subtree_empty_when_root_missing(db_session, sample_project):
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-MISSING")
    assert subtree == []


async def test_suite_subtree_cross_project_isolation(
    db_session, sample_project, second_project
):
    # Same wombat_id "SUITE-A" in both projects, with descendants only in
    # sample_project — the second project's SUITE-A must not leak.
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    await _make_suite(db_session, sample_project, "SUITE-B", parent="SUITE-A")
    await _make_suite(db_session, second_project, "SUITE-A", parent=None)
    await _make_suite(db_session, second_project, "SUITE-X", parent="SUITE-A")

    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A")
    assert all(s.project_id == sample_project.id for s in subtree)
    assert {s.wombat_id for s in subtree} == {"SUITE-A", "SUITE-B"}


async def test_suite_subtree_multi_child(db_session, sample_project):
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    await _make_suite(db_session, sample_project, "SUITE-B", parent="SUITE-A")
    await _make_suite(db_session, sample_project, "SUITE-C", parent="SUITE-A")
    await _make_suite(db_session, sample_project, "SUITE-D", parent="SUITE-B")
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A")
    assert {s.wombat_id for s in subtree} == {
        "SUITE-A",
        "SUITE-B",
        "SUITE-C",
        "SUITE-D",
    }


async def test_suite_subtree_depth_limit_stops_expansion(db_session, sample_project):
    # Build A -> B -> C; depth_limit=1 should return only A and B.
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    await _make_suite(db_session, sample_project, "SUITE-B", parent="SUITE-A")
    await _make_suite(db_session, sample_project, "SUITE-C", parent="SUITE-B")
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A", depth_limit=1)
    assert {s.wombat_id for s in subtree} == {"SUITE-A", "SUITE-B"}


async def test_suite_subtree_ignores_non_suite_kinds(db_session, sample_project):
    # A testcase with parent_wombat_id=SUITE-A should NOT be pulled into
    # the subtree — we only recurse over kind='suite'.
    await _make_suite(db_session, sample_project, "SUITE-A", parent=None)
    row = Content(
        id=uuid.uuid4(),
        project_id=sample_project.id,
        kind="testcase",
        wombat_id="TC-X",
        title="TC-X",
        tags=[],
        body={"id": "TC-X", "title": "TC-X", "parent_wombat_id": "SUITE-A"},
        source_repo="r",
        source_path="cases/tcx.md",
        source_revision="rev",
        content_hash="h-tcx",
    )
    db_session.add(row)
    await db_session.flush()
    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(sample_project.id, "SUITE-A")
    assert all(s.kind == "suite" for s in subtree)
    assert {s.wombat_id for s in subtree} == {"SUITE-A"}


# ---------------------------------------------------------------------------
# get_content_by_wombat_ids
# ---------------------------------------------------------------------------


async def test_get_content_by_wombat_ids_returns_only_known(
    db_session, sample_project
):
    await _make_testcase(db_session, sample_project, "TC-1")
    await _make_testcase(db_session, sample_project, "TC-2")
    repo = Repository(db_session)
    rows = await repo.get_content_by_wombat_ids(
        sample_project.id, ["TC-1", "TC-2", "TC-MISSING"]
    )
    assert {r.wombat_id for r in rows} == {"TC-1", "TC-2"}


async def test_get_content_by_wombat_ids_empty_input_returns_empty(
    db_session, sample_project
):
    repo = Repository(db_session)
    rows = await repo.get_content_by_wombat_ids(sample_project.id, [])
    assert rows == []


async def test_get_content_by_wombat_ids_cross_project_isolated(
    db_session, sample_project, second_project
):
    await _make_testcase(db_session, sample_project, "TC-1")
    await _make_testcase(db_session, second_project, "TC-1")
    repo = Repository(db_session)
    rows = await repo.get_content_by_wombat_ids(sample_project.id, ["TC-1"])
    assert len(rows) == 1
    assert rows[0].project_id == sample_project.id


async def test_get_content_by_wombat_ids_skips_soft_deleted(
    db_session, sample_project
):
    from datetime import UTC, datetime

    row = await _make_testcase(db_session, sample_project, "TC-1")
    row.deleted_at = datetime.now(UTC)
    await db_session.flush()
    repo = Repository(db_session)
    rows = await repo.get_content_by_wombat_ids(sample_project.id, ["TC-1"])
    assert rows == []
