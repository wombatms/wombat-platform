"""Postgres-only integration tests for the SP3.4 suite-subtree CTE.

The unit-level tests in ``tests/unit/api/test_repository_content.py`` cover
the SQLite BFS fallback.  This module exercises the ``WITH RECURSIVE``
Postgres path against a real pg16+pgvector instance so we know the SQL
actually compiles and returns the expected shape.
"""

from __future__ import annotations

import uuid

import pytest_asyncio

from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository


async def _make_pg_suite(
    db_session,
    project_id: uuid.UUID,
    wombat_id: str,
    parent: str | None = None,
) -> Content:
    body: dict = {"id": wombat_id, "title": wombat_id, "owner": "qa"}
    if parent is not None:
        body["parent_wombat_id"] = parent
    row = Content(
        id=uuid.uuid4(),
        project_id=project_id,
        kind="suite",
        wombat_id=wombat_id,
        title=wombat_id,
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"suites/{wombat_id}.yml",
        source_revision="rev-1",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


@pytest_asyncio.fixture
async def pg_subtree_project(db_session, seeded_project) -> ProjectDB:
    # seeded_project is already committed — returned as (ProjectDB, slug).
    project, _slug = seeded_project
    return project


async def test_pg_recursive_cte_three_level_subtree(pg_subtree_project, db_session):
    await _make_pg_suite(db_session, pg_subtree_project.id, "SUITE-SP34-A", parent=None)
    await _make_pg_suite(
        db_session, pg_subtree_project.id, "SUITE-SP34-B", parent="SUITE-SP34-A"
    )
    await _make_pg_suite(
        db_session, pg_subtree_project.id, "SUITE-SP34-C", parent="SUITE-SP34-B"
    )
    await db_session.flush()

    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(pg_subtree_project.id, "SUITE-SP34-A")
    assert {s.wombat_id for s in subtree} == {
        "SUITE-SP34-A",
        "SUITE-SP34-B",
        "SUITE-SP34-C",
    }
    for row in subtree:
        assert row.project_id == pg_subtree_project.id


async def test_pg_recursive_cte_respects_depth_limit(pg_subtree_project, db_session):
    await _make_pg_suite(db_session, pg_subtree_project.id, "SUITE-DL-A", parent=None)
    await _make_pg_suite(
        db_session, pg_subtree_project.id, "SUITE-DL-B", parent="SUITE-DL-A"
    )
    await _make_pg_suite(
        db_session, pg_subtree_project.id, "SUITE-DL-C", parent="SUITE-DL-B"
    )
    await db_session.flush()

    repo = Repository(db_session)
    subtree = await repo.list_suite_subtree(
        pg_subtree_project.id, "SUITE-DL-A", depth_limit=1
    )
    assert {s.wombat_id for s in subtree} == {"SUITE-DL-A", "SUITE-DL-B"}


async def test_pg_get_content_by_wombat_ids_batch(pg_subtree_project, db_session):
    row1 = Content(
        id=uuid.uuid4(),
        project_id=pg_subtree_project.id,
        kind="testcase",
        wombat_id="TC-SP34-1",
        title="TC-SP34-1",
        tags=[],
        body={"id": "TC-SP34-1", "title": "TC-SP34-1"},
        source_repo="r",
        source_path="cases/1.md",
        source_revision="rev",
        content_hash=f"h-sp34-1-{uuid.uuid4().hex[:6]}",
    )
    row2 = Content(
        id=uuid.uuid4(),
        project_id=pg_subtree_project.id,
        kind="testcase",
        wombat_id="TC-SP34-2",
        title="TC-SP34-2",
        tags=[],
        body={"id": "TC-SP34-2", "title": "TC-SP34-2"},
        source_repo="r",
        source_path="cases/2.md",
        source_revision="rev",
        content_hash=f"h-sp34-2-{uuid.uuid4().hex[:6]}",
    )
    db_session.add_all([row1, row2])
    await db_session.flush()

    repo = Repository(db_session)
    rows = await repo.get_content_by_wombat_ids(
        pg_subtree_project.id, ["TC-SP34-1", "TC-SP34-2", "TC-SP34-MISSING"]
    )
    assert {r.wombat_id for r in rows} == {"TC-SP34-1", "TC-SP34-2"}
