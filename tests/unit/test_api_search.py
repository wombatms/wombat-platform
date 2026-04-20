"""Unit tests for wombat_api.search.hybrid — semantic mode on SQLite.

The full hybrid / keyword modes require Postgres (pgvector + FTS).  These
tests exercise the SQLite semantic-only fallback path, which is sufficient for
unit testing the scoring logic without a live Postgres instance.

A Postgres integration test is skipped unless WOMBAT_TEST_DATABASE_URL is set
to a postgresql+asyncpg:// URL.
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from wombat_api.database.models import Content, EMBED_DIM
from wombat_api.search.hybrid import hybrid_search, _cosine

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def sqlite_session():
    """In-memory SQLite session with tables created."""
    from wombat_api.database.engine import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine)() as s:
        yield s
    await engine.dispose()


def _make_embedding(seed: float) -> list[float]:
    """Return a unit-normalised EMBED_DIM vector seeded by seed."""
    import math
    vec = [math.sin(seed + i * 0.1) for i in range(EMBED_DIM)]
    mag = sum(x * x for x in vec) ** 0.5
    return [x / mag for x in vec]


async def _insert_content(
    session,
    project_id: uuid.UUID,
    wombat_id: str,
    title: str,
    kind: str,
    embedding: list[float],
) -> Content:
    row = Content(
        id=uuid.uuid4(),
        project_id=project_id,
        kind=kind,
        wombat_id=wombat_id,
        title=title,
        tags=[],
        body={"summary": f"Summary of {title}"},
        source_repo="test-repo",
        source_path=f"testcases/{wombat_id}.md",
        source_revision="abc123",
        content_hash="deadbeef",
        embedding=embedding,
    )
    session.add(row)
    await session.flush()
    return row


# ---------------------------------------------------------------------------
# _cosine helper tests
# ---------------------------------------------------------------------------


class TestCosineHelper:
    def test_identical_vectors(self):
        vec = [1.0, 0.0, 0.0]
        assert abs(_cosine(vec, vec) - 1.0) < 1e-6

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert abs(_cosine(a, b)) < 1e-6

    def test_opposite_vectors(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert abs(_cosine(a, b) - (-1.0)) < 1e-6

    def test_zero_vector_returns_zero(self):
        assert _cosine([0.0, 0.0], [1.0, 0.0]) == 0.0

    def test_mismatched_dims_returns_zero(self):
        assert _cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0


# ---------------------------------------------------------------------------
# SQLite semantic search
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_semantic_search_returns_hits(sqlite_session):
    project_id = uuid.uuid4()
    q_vec = _make_embedding(0.0)
    # Insert three rows with different embeddings.
    # Row 1 is very close to the query vector (seed=0.01 ≈ similar).
    await _insert_content(sqlite_session, project_id, "TC-001", "Close match", "testcase", _make_embedding(0.01))
    await _insert_content(sqlite_session, project_id, "TC-002", "Medium match", "testcase", _make_embedding(1.0))
    await _insert_content(sqlite_session, project_id, "TC-003", "Far match", "testcase", _make_embedding(3.0))
    await sqlite_session.commit()

    hits = await hybrid_search(
        sqlite_session,
        project_id=project_id,
        query="test query",
        query_embedding=q_vec,
        mode="semantic",
        top_k=3,
    )

    assert len(hits) == 3
    # The closest-embedding row should rank first.
    assert hits[0]["wombat_id"] == "TC-001"


@pytest.mark.asyncio
async def test_semantic_search_top_k_limits_results(sqlite_session):
    project_id = uuid.uuid4()
    q_vec = _make_embedding(0.0)
    for i in range(5):
        await _insert_content(
            sqlite_session, project_id, f"TC-{i:03d}", f"Case {i}", "testcase",
            _make_embedding(float(i) * 0.5),
        )
    await sqlite_session.commit()

    hits = await hybrid_search(
        sqlite_session,
        project_id=project_id,
        query="query",
        query_embedding=q_vec,
        mode="semantic",
        top_k=2,
    )
    assert len(hits) == 2


@pytest.mark.asyncio
async def test_semantic_search_excludes_other_projects(sqlite_session):
    project_a = uuid.uuid4()
    project_b = uuid.uuid4()
    q_vec = _make_embedding(0.0)

    await _insert_content(sqlite_session, project_a, "TC-A", "Project A", "testcase", _make_embedding(0.01))
    await _insert_content(sqlite_session, project_b, "TC-B", "Project B", "testcase", _make_embedding(0.01))
    await sqlite_session.commit()

    hits = await hybrid_search(
        sqlite_session,
        project_id=project_a,
        query="query",
        query_embedding=q_vec,
        mode="semantic",
        top_k=10,
    )
    assert len(hits) == 1
    assert hits[0]["wombat_id"] == "TC-A"


@pytest.mark.asyncio
async def test_semantic_search_respects_kind_filter(sqlite_session):
    project_id = uuid.uuid4()
    q_vec = _make_embedding(0.0)

    await _insert_content(sqlite_session, project_id, "TC-001", "Test case", "testcase", _make_embedding(0.01))
    await _insert_content(sqlite_session, project_id, "DOC-001", "A doc", "doc", _make_embedding(0.01))
    await sqlite_session.commit()

    hits = await hybrid_search(
        sqlite_session,
        project_id=project_id,
        query="query",
        query_embedding=q_vec,
        kinds=["testcase"],
        mode="semantic",
        top_k=10,
    )
    assert all(h["kind"] == "testcase" for h in hits)
    assert len(hits) == 1


@pytest.mark.asyncio
async def test_semantic_search_empty_project(sqlite_session):
    project_id = uuid.uuid4()
    hits = await hybrid_search(
        sqlite_session,
        project_id=project_id,
        query="anything",
        query_embedding=_make_embedding(0.0),
        mode="semantic",
    )
    assert hits == []


@pytest.mark.asyncio
async def test_hybrid_mode_raises_not_implemented_on_sqlite(sqlite_session):
    project_id = uuid.uuid4()
    with pytest.raises(NotImplementedError, match="requires Postgres"):
        await hybrid_search(
            sqlite_session,
            project_id=project_id,
            query="test",
            query_embedding=_make_embedding(0.0),
            mode="hybrid",
        )


@pytest.mark.asyncio
async def test_keyword_mode_raises_not_implemented_on_sqlite(sqlite_session):
    project_id = uuid.uuid4()
    with pytest.raises(NotImplementedError, match="requires Postgres"):
        await hybrid_search(
            sqlite_session,
            project_id=project_id,
            query="test",
            query_embedding=_make_embedding(0.0),
            mode="keyword",
        )


@pytest.mark.asyncio
async def test_hit_contains_expected_fields(sqlite_session):
    project_id = uuid.uuid4()
    q_vec = _make_embedding(0.0)
    await _insert_content(sqlite_session, project_id, "TC-001", "My test", "testcase", _make_embedding(0.01))
    await sqlite_session.commit()

    hits = await hybrid_search(
        sqlite_session,
        project_id=project_id,
        query="test",
        query_embedding=q_vec,
        mode="semantic",
        top_k=1,
    )
    assert len(hits) == 1
    hit = hits[0]
    assert "id" in hit
    assert "kind" in hit
    assert "wombat_id" in hit
    assert "title" in hit
    assert "score" in hit
    assert "snippet" in hit
    assert "source" in hit
    assert "repo" in hit["source"]
    assert "path" in hit["source"]


# ---------------------------------------------------------------------------
# Postgres integration test (skipped unless WOMBAT_TEST_DATABASE_URL is set)
# ---------------------------------------------------------------------------

_PG_URL = os.environ.get("WOMBAT_TEST_DATABASE_URL", "")
_pg_skip = pytest.mark.skipif(
    not _PG_URL or "postgresql" not in _PG_URL,
    reason="WOMBAT_TEST_DATABASE_URL not set to a Postgres URL — skipping Postgres tests",
)


@_pg_skip
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_postgres_hybrid_search():
    """Integration test: hybrid search on a real Postgres instance.

    Requires WOMBAT_TEST_DATABASE_URL=postgresql+asyncpg://...
    and the schema already migrated (head).
    """
    engine = create_async_engine(_PG_URL)
    async with async_sessionmaker(engine)() as session:
        project_id = uuid.uuid4()
        # Insert a testcase with a real embedding.
        q_vec = _make_embedding(0.5)
        emb = _make_embedding(0.5)
        await _insert_content(session, project_id, "TC-PG-001", "Postgres test", "testcase", emb)
        await session.commit()

        hits = await hybrid_search(
            session,
            project_id=project_id,
            query="postgres test",
            query_embedding=q_vec,
            mode="hybrid",
            top_k=5,
        )
        assert len(hits) >= 1
        assert hits[0]["wombat_id"] == "TC-PG-001"

    await engine.dispose()
