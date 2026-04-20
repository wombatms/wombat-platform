"""Repository-layer RBAC isolation tests.

These tests verify that Repository queries are scoped to a single project_id
and never return rows belonging to a different project.

Backend: SQLite in-memory (no Postgres required).

The same pattern used in test_indexer.py is followed:
- Create the schema via Base.metadata.create_all.
- Seed two separate projects (A and B) with identical content in each.
- Issue queries scoped to project A and assert no project-B rows appear.

Note on SQLite compatibility:
- The pgvector Vector column falls back to TEXT under SQLite.
- The tags.contains([t]) ORM expression uses JSON array containment which
  may not work under SQLite.  For these tests we add tags without filtering
  on them (filtering is a Postgres-level concern covered by integration tests).
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from wombat_api.database.engine import Base
from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository, content_hash_for


# ---------------------------------------------------------------------------
# Shared fixture: in-memory SQLite session
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def session():
    """SQLite in-memory session for unit tests.

    pgvector Vector columns fall back to TEXT under SQLite; basic CRUD works
    but vector similarity queries do not.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_project(session, slug: str) -> ProjectDB:
    """Create and flush a ProjectDB row."""
    proj = ProjectDB(
        id=uuid.uuid4(),
        slug=slug,
        name=slug.upper(),
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    session.add(proj)
    await session.flush()
    return proj


def _make_content(
    project_id: uuid.UUID,
    wombat_id: str,
    kind: str = "testcase",
    title: str = "Test case title",
    tags: list[str] | None = None,
) -> Content:
    """Build a Content row (not yet added to session)."""
    body = {"title": title, "wombat_id": wombat_id}
    return Content(
        id=uuid.uuid4(),
        project_id=project_id,
        kind=kind,
        wombat_id=wombat_id,
        title=title,
        tags=tags or [],
        body=body,
        embedding=None,
        source_repo="repo",
        source_path=f"testcases/{wombat_id}.md",
        source_revision="abc123",
        content_hash=content_hash_for(body),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_content_scoped_to_project(session):
    """list_content must return only rows belonging to project A."""
    proj_a = await _seed_project(session, "project-a")
    proj_b = await _seed_project(session, "project-b")

    # Seed matching content in both projects.
    for wid in ["TC-001", "TC-002"]:
        session.add(_make_content(proj_a.id, wid, title="payment refund test"))
        session.add(_make_content(proj_b.id, wid, title="payment refund test"))
    await session.flush()

    repo = Repository(session)
    rows, total = await repo.list_content(project_id=proj_a.id)

    assert total == 2
    assert len(rows) == 2
    for row in rows:
        assert row.project_id == proj_a.id, (
            f"Row {row.wombat_id} has project_id={row.project_id} "
            f"but expected {proj_a.id}"
        )


@pytest.mark.asyncio
async def test_list_content_by_kind_scoped_to_project(session):
    """list_content with kind='testcase' must not return other-project rows."""
    proj_a = await _seed_project(session, "project-a-kind")
    proj_b = await _seed_project(session, "project-b-kind")

    # Add a testcase to each project.
    session.add(_make_content(proj_a.id, "TC-A-001", kind="testcase"))
    session.add(_make_content(proj_b.id, "TC-B-001", kind="testcase"))
    await session.flush()

    repo = Repository(session)
    rows, total = await repo.list_content(project_id=proj_a.id, kind="testcase")

    assert total == 1
    assert rows[0].project_id == proj_a.id
    assert rows[0].wombat_id == "TC-A-001"


@pytest.mark.asyncio
async def test_get_content_by_wombat_id_scoped_to_project(session):
    """get_content_by_wombat_id must return the project-A row, not project-B's.

    When two projects each have a content row with the same wombat_id, the
    repository must resolve to the one belonging to the requested project.
    """
    proj_a = await _seed_project(session, "project-a-wid")
    proj_b = await _seed_project(session, "project-b-wid")

    shared_wid = "TC-SHARED-001"
    row_a = _make_content(proj_a.id, shared_wid, title="Title from A")
    row_b = _make_content(proj_b.id, shared_wid, title="Title from B")
    session.add(row_a)
    session.add(row_b)
    await session.flush()

    repo = Repository(session)

    result_a = await repo.get_content_by_wombat_id(
        project_id=proj_a.id, kind="testcase", wombat_id=shared_wid
    )
    assert result_a is not None
    assert result_a.id == row_a.id
    assert result_a.title == "Title from A"

    result_b = await repo.get_content_by_wombat_id(
        project_id=proj_b.id, kind="testcase", wombat_id=shared_wid
    )
    assert result_b is not None
    assert result_b.id == row_b.id
    assert result_b.title == "Title from B"


@pytest.mark.asyncio
async def test_list_content_no_cross_project_leakage_with_many_rows(session):
    """Bulk seed both projects; query A returns exactly its N rows."""
    proj_a = await _seed_project(session, "project-a-bulk")
    proj_b = await _seed_project(session, "project-b-bulk")

    n_per_project = 5
    for i in range(n_per_project):
        session.add(_make_content(proj_a.id, f"TC-A-{i:03d}", title=f"A row {i}"))
        session.add(_make_content(proj_b.id, f"TC-B-{i:03d}", title=f"B row {i}"))
    await session.flush()

    repo = Repository(session)
    rows_a, total_a = await repo.list_content(project_id=proj_a.id)
    assert total_a == n_per_project
    assert all(r.project_id == proj_a.id for r in rows_a)

    rows_b, total_b = await repo.list_content(project_id=proj_b.id)
    assert total_b == n_per_project
    assert all(r.project_id == proj_b.id for r in rows_b)


@pytest.mark.asyncio
async def test_list_content_empty_project_returns_zero(session):
    """A project with no content rows returns ([], 0)."""
    proj = await _seed_project(session, "empty-project")

    repo = Repository(session)
    rows, total = await repo.list_content(project_id=proj.id)

    assert rows == []
    assert total == 0


@pytest.mark.asyncio
async def test_get_content_by_wombat_id_returns_none_for_wrong_project(session):
    """get_content_by_wombat_id returns None when wombat_id exists only in project B."""
    proj_a = await _seed_project(session, "project-a-miss")
    proj_b = await _seed_project(session, "project-b-miss")

    # Only seed the row in project B.
    session.add(_make_content(proj_b.id, "TC-B-ONLY", title="Only in B"))
    await session.flush()

    repo = Repository(session)
    result = await repo.get_content_by_wombat_id(
        project_id=proj_a.id, kind="testcase", wombat_id="TC-B-ONLY"
    )
    assert result is None, "Must not return a row from a different project"
