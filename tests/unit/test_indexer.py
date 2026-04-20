"""Tests for the indexer pipeline."""

import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from wombat_api.database.repository import Repository
from wombat_api.sync.indexer import Indexer


class _FakeEmbedder:
    """Fake embedder that returns 384-dim vectors to match EMBED_DIM=384.

    Dimension must match the pgvector Vector(EMBED_DIM) column, which enforces
    the configured dim even under SQLite (the shim validates before writing).
    """

    name = "fake"
    dim = 384

    async def embed_batch(self, texts):
        from wombat_api.database.models import EMBED_DIM

        return [[float(len(t))] + [0.0] * (EMBED_DIM - 1) for t in texts]


@pytest_asyncio.fixture
async def session():
    """SQLite in-memory session for unit tests.

    Note: pgvector's Vector column type is Postgres-specific and falls back to
    a simple TEXT column under SQLite (via the pgvector compatibility shim).
    Tables are created with create_all; vector similarity queries will not work
    but basic CRUD (used by the indexer) is fine.
    """
    from wombat_api.database.engine import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine)() as s:
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_indexer_indexes_new_files(tmp_path: Path, session):
    (tmp_path / "testcases").mkdir()
    f = tmp_path / "testcases/tc-1.md"
    f.write_text("---\nid: TC-AUTH-001\ntitle: T1\ntags: [auth]\ncomponent: auth\nowner: qa\n---\n\nSummary.\n")
    repo = Repository(session)
    project_id = uuid.uuid4()
    # seed project
    from wombat_api.database.models import ProjectDB

    session.add(ProjectDB(id=project_id, slug="p", name="P", taxonomy_components=[], taxonomy_environments=[]))
    await session.flush()

    idx = Indexer(
        repository=repo,
        embedder=_FakeEmbedder(),
        batch_size=10,
        chunk_size_tokens=500,
        chunk_overlap_tokens=50,
    )
    await idx.sync_project(
        project_id=project_id,
        test_repo_root=tmp_path,
        sources_root=tmp_path / ".wombat/sources",
        app_repos=[],
        docs_folder=None,
    )
    await session.commit()

    rows, total = await repo.list_content(project_id=project_id, kind="testcase")
    assert total == 1
    assert rows[0].embedding is not None


@pytest.mark.asyncio
async def test_indexer_skips_unchanged_content(tmp_path: Path, session):
    """Same content_hash on repeat sync -> no re-embed."""
    (tmp_path / "testcases").mkdir()
    (tmp_path / "testcases/tc-1.md").write_text(
        "---\nid: TC-AUTH-001\ntitle: T1\ncomponent: auth\nowner: qa\n---\n\nSame.\n"
    )
    from wombat_api.database.models import ProjectDB

    repo = Repository(session)
    project_id = uuid.uuid4()
    session.add(ProjectDB(id=project_id, slug="p", name="P", taxonomy_components=[], taxonomy_environments=[]))
    await session.flush()

    embedder = _FakeEmbedder()
    call_count = {"n": 0}
    orig = embedder.embed_batch

    async def counting(texts):
        call_count["n"] += 1
        return await orig(texts)

    embedder.embed_batch = counting  # type: ignore

    idx = Indexer(
        repository=repo,
        embedder=embedder,
        batch_size=10,
        chunk_size_tokens=500,
        chunk_overlap_tokens=50,
    )
    await idx.sync_project(project_id, tmp_path, tmp_path / ".w", [], None)
    first_calls = call_count["n"]
    await session.commit()
    await idx.sync_project(project_id, tmp_path, tmp_path / ".w", [], None)
    assert call_count["n"] == first_calls, "content_hash skip failed"
