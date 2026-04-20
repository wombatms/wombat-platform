"""Sync integration tests (spec §12.3 risk: skip-logic).

Scenarios:
1. First sync → entities_created=2, embeddings populated on Content rows.
2. Second sync, no changes → entities_skipped=2, embedded=0 (zero re-embeds).
3. Edit one testcase file → third sync → entities_updated=1, entities_skipped=1,
   new content_hash on the edited row.
4. Delete one testcase file → fourth sync → entities_deleted=1 (soft-delete,
   deleted_at set).

Uses the Indexer directly (not the HTTP API) so the sync route's dependency
on the real embedder doesn't need to be mocked.  The Indexer is invoked with
FakeEmbedder.

The spec §12.3 risk is: "Second sync re-embeds unchanged content" — test #2
confirms skipped=2, embedded=0 after a no-op sync.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.sync.indexer import Indexer


class _FakeEmbedder:
    name = "fake"
    dim = 384
    _call_count = 0

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        from wombat_api.database.models import EMBED_DIM
        self._call_count += len(texts)
        return [[float(len(t) % 256) / 256.0] + [0.0] * (EMBED_DIM - 1) for t in texts]


def _write_testcase(path: Path, wombat_id: str, title: str, body: str = "Summary.") -> None:
    path.write_text(
        f"---\nid: {wombat_id}\ntitle: {title}\n"
        f"tags: [auth]\ncomponent: auth\nowner: qa\n---\n\n{body}\n"
    )


@pytest.fixture
def repo_root(tmp_path: Path) -> Path:
    """Create a minimal test-repo directory with 2 testcases."""
    tc_dir = tmp_path / "testcases"
    tc_dir.mkdir()
    _write_testcase(tc_dir / "tc-sync-001.md", "TC-SYNC-001", "First sync testcase")
    _write_testcase(tc_dir / "tc-sync-002.md", "TC-SYNC-002", "Second sync testcase")
    return tmp_path


async def _make_project(db_session: AsyncSession) -> ProjectDB:
    slug = f"sync-test-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Sync Test Project",
        org="test",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project)
    await db_session.flush()
    await db_session.commit()
    return project


async def _run_sync(async_engine, project_id, repo_root: Path, embedder=None) -> object:
    if embedder is None:
        embedder = _FakeEmbedder()
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as s:
        repo = Repository(s)
        idx = Indexer(
            repository=repo,
            embedder=embedder,
            batch_size=50,
            chunk_size_tokens=500,
            chunk_overlap_tokens=50,
        )
        progress = await idx.sync_project(
            project_id=project_id,
            test_repo_root=repo_root,
            sources_root=repo_root,
            app_repos=[],
            docs_folder=None,
        )
        await s.commit()
    return progress


async def _count_content(async_engine, project_id, active_only: bool = True) -> list[Content]:
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as s:
        conds = [Content.project_id == project_id]
        if active_only:
            conds.append(Content.deleted_at.is_(None))
        rows = (await s.execute(select(Content).where(*conds))).scalars().all()
    return list(rows)


@pytest.mark.asyncio
async def test_first_sync_creates_and_embeds(
    db_session: AsyncSession,
    async_engine,
    seeded_project,
):
    """First sync: 2 files → 2 created, 2 embedded, 0 skipped."""
    project, slug = seeded_project
    repo_root_path = None

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rp = Path(tmp)
        tc_dir = rp / "testcases"
        tc_dir.mkdir()
        _write_testcase(tc_dir / "tc-sync-001.md", "TC-SYNC-001", "First sync testcase")
        _write_testcase(tc_dir / "tc-sync-002.md", "TC-SYNC-002", "Second sync testcase")

        progress = await _run_sync(async_engine, project.id, rp)

    assert progress.total == 2
    assert progress.seen == 2
    assert progress.embedded == 2
    assert progress.skipped == 0
    assert progress.errors == []

    # Verify embeddings are populated in the DB
    rows = await _count_content(async_engine, project.id)
    assert len(rows) == 2
    for row in rows:
        assert row.embedding is not None, f"Embedding missing for {row.wombat_id}"
        assert row.content_hash is not None


@pytest.mark.asyncio
async def test_second_sync_skips_unchanged(
    db_session: AsyncSession,
    async_engine,
    seeded_project,
):
    """Second sync with no changes: all rows skipped, zero re-embeds (§12.3 guard)."""
    project, slug = seeded_project
    embedder = _FakeEmbedder()

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rp = Path(tmp)
        tc_dir = rp / "testcases"
        tc_dir.mkdir()
        _write_testcase(tc_dir / "tc-sync-001.md", "TC-SYNC-001", "First sync testcase")
        _write_testcase(tc_dir / "tc-sync-002.md", "TC-SYNC-002", "Second sync testcase")

        # First sync
        p1 = await _run_sync(async_engine, project.id, rp, embedder)
        calls_after_first = embedder._call_count

        # Second sync — identical content
        p2 = await _run_sync(async_engine, project.id, rp, embedder)
        calls_after_second = embedder._call_count

    # Second sync: spec §12.3 risk guard
    assert p2.skipped == 2, f"Expected skipped=2, got {p2.skipped}"
    assert p2.embedded == 0, f"Expected embedded=0, got {p2.embedded} (zero re-embeds)"
    assert calls_after_second == calls_after_first, (
        "Embedder was called during no-op sync! "
        f"Extra calls: {calls_after_second - calls_after_first}"
    )


@pytest.mark.asyncio
async def test_third_sync_updates_edited_file(
    db_session: AsyncSession,
    async_engine,
    seeded_project,
):
    """Editing one testcase → third sync updates 1, skips 1, new content_hash."""
    project, slug = seeded_project
    embedder = _FakeEmbedder()

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rp = Path(tmp)
        tc_dir = rp / "testcases"
        tc_dir.mkdir()
        _write_testcase(tc_dir / "tc-sync-001.md", "TC-SYNC-001", "Original title")
        _write_testcase(tc_dir / "tc-sync-002.md", "TC-SYNC-002", "Second sync testcase")

        # First sync
        await _run_sync(async_engine, project.id, rp, embedder)

        # Get hash before edit
        factory = async_sessionmaker(async_engine, expire_on_commit=False)
        async with factory() as s:
            rows = (await s.execute(
                select(Content).where(Content.project_id == project.id)
            )).scalars().all()
        hash_before = {r.wombat_id: r.content_hash for r in rows}

        # Edit one testcase (no colon in title — YAML-safe)
        _write_testcase(tc_dir / "tc-sync-001.md", "TC-SYNC-001", "Updated edited title new content")

        # Third sync
        p3 = await _run_sync(async_engine, project.id, rp, embedder)

    # 1 updated (seen + embedded), 1 skipped
    assert p3.seen == 1, f"Expected seen=1, got {p3.seen}"
    assert p3.embedded == 1, f"Expected embedded=1, got {p3.embedded}"
    assert p3.skipped == 1, f"Expected skipped=1, got {p3.skipped}"

    # Verify content_hash changed for the edited row
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as s:
        rows = (await s.execute(
            select(Content).where(Content.project_id == project.id)
        )).scalars().all()
    hash_after = {r.wombat_id: r.content_hash for r in rows}
    assert hash_after["TC-SYNC-001"] != hash_before["TC-SYNC-001"], (
        "Content hash should have changed after editing TC-SYNC-001"
    )
    assert hash_after.get("TC-SYNC-002") == hash_before.get("TC-SYNC-002"), (
        "TC-SYNC-002 should not have changed"
    )


@pytest.mark.asyncio
async def test_fourth_sync_soft_deletes_removed_file(
    db_session: AsyncSession,
    async_engine,
    seeded_project,
):
    """Deleting one testcase file → fourth sync soft-deletes it (deleted_at set)."""
    project, slug = seeded_project

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        rp = Path(tmp)
        tc_dir = rp / "testcases"
        tc_dir.mkdir()
        tc1 = tc_dir / "tc-sync-001.md"
        tc2 = tc_dir / "tc-sync-002.md"
        _write_testcase(tc1, "TC-SYNC-001", "First testcase")
        _write_testcase(tc2, "TC-SYNC-002", "Second testcase")

        # First sync — both present
        await _run_sync(async_engine, project.id, rp)

        # Delete tc2
        tc2.unlink()

        # Second sync — tc2 missing
        await _run_sync(async_engine, project.id, rp)

    # Check soft-delete
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as s:
        all_rows = (await s.execute(
            select(Content).where(Content.project_id == project.id)
        )).scalars().all()

    active = [r for r in all_rows if r.deleted_at is None]
    deleted = [r for r in all_rows if r.deleted_at is not None]

    assert len(active) == 1, f"Expected 1 active row, got {len(active)}"
    assert len(deleted) == 1, f"Expected 1 soft-deleted row, got {len(deleted)}"
    assert active[0].wombat_id == "TC-SYNC-001"
    assert deleted[0].wombat_id == "TC-SYNC-002"
    assert deleted[0].deleted_at is not None
