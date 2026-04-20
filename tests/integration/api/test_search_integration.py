"""Search integration tests — RBAC leakage guard (spec §12.5).

This file is the primary security regression guard for search isolation.
It seeds TWO projects (A and B) with overlapping vocabulary and verifies:

1. A viewer of project A ONLY can search project A and gets only project-A hits.
2. No project-B content IDs appear in project-A search results.
3. Attempting to search project B as project-A viewer → 403.
4. top_k is honored.
5. kind filter works.

Uses testcontainers Postgres (same as all other integration tests) via conftest.
The search route's embedder is patched with FakeEmbedder so sentence-transformers
is not required.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# Shared across this module
INTEGRATION_REPO = Path(__file__).parent.parent.parent / "fixtures" / "integration_repo"


class _FakeEmbedder:
    name = "fake"
    dim = 384

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        from wombat_api.database.models import EMBED_DIM
        # Each text gets a deterministic unit vector based on its length
        return [
            [float((i * 7 + j) % 100) / 100.0 if j == 0 else 0.0
             for j in range(EMBED_DIM)]
            for i, _ in enumerate(texts)
        ]


_FAKE_EMBEDDER_INSTANCE = _FakeEmbedder()


@pytest.fixture(autouse=True)
def _patch_search_embedder():
    """Patch the search route embedder with FakeEmbedder for all tests in this module.

    The search route lazily loads the embedder via load_embedder().
    We patch both _get_embedder and the module-level _embedder to avoid
    sentence-transformers being loaded.
    """
    import wombat_api.routes.search as _search_mod
    with patch.object(_search_mod, "_get_embedder", return_value=_FAKE_EMBEDDER_INSTANCE):
        # Also reset the cached embedder so the patch takes effect
        orig = _search_mod._embedder
        _search_mod._embedder = _FAKE_EMBEDDER_INSTANCE
        yield
        _search_mod._embedder = orig


async def _create_and_seed_project(
    db_session: AsyncSession,
    async_engine,
    slug: str,
    testcases: list[dict],
) -> object:
    """Create a project and seed it with the given testcases directly via upsert.

    Each testcase dict: {wombat_id, title, tags, body_text}
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from wombat_api.database.models import ProjectDB
    from wombat_api.database.repository import Repository

    project = ProjectDB(
        slug=slug,
        name=f"Search Test Project ({slug})",
        org="test-org",
        taxonomy_components=["auth", "payments"],
        taxonomy_environments=["staging"],
    )
    db_session.add(project)
    await db_session.flush()
    await db_session.commit()

    # Seed content rows directly (avoids needing a real git repo layout)
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as s:
        repo = Repository(s)
        embedder = _FakeEmbedder()
        texts = [tc["title"] + " " + tc["body_text"] for tc in testcases]
        vectors = await embedder.embed_batch(texts)

        for tc, vec in zip(testcases, vectors):
            await repo.upsert_content(
                project_id=project.id,
                kind="testcase",
                wombat_id=tc["wombat_id"],
                title=tc["title"],
                tags=tc.get("tags", []),
                body={"summary": tc["body_text"]},
                source_repo="test-repo",
                source_path=f"testcases/{tc['wombat_id'].lower()}.md",
                source_revision="HEAD",
                embedding=vec,
            )
        await s.commit()

    return project


# ---------------------------------------------------------------------------
# Fixtures shared by all search tests
# ---------------------------------------------------------------------------

_PROJECT_A_TESTCASES = [
    {
        "wombat_id": "TC-SRCH-A-001",
        "title": "Refund eligibility for completed orders",
        "tags": ["payments", "refund"],
        "body_text": "Verify refund eligibility check in payments service.",
    },
    {
        "wombat_id": "TC-SRCH-A-002",
        "title": "Auth login flow with valid credentials",
        "tags": ["auth", "login"],
        "body_text": "User authenticates successfully with valid email and password.",
    },
    {
        "wombat_id": "TC-SRCH-A-003",
        "title": "Payments retry on transient failure",
        "tags": ["payments", "retry"],
        "body_text": "Payment gateway retries on 503 response.",
    },
]

_PROJECT_B_TESTCASES = [
    {
        "wombat_id": "TC-SRCH-B-001",
        "title": "Refund eligibility check project B",
        "tags": ["payments", "refund"],
        "body_text": "Project B refund eligibility verification.",
    },
    {
        "wombat_id": "TC-SRCH-B-002",
        "title": "Auth login flow project B",
        "tags": ["auth", "login"],
        "body_text": "Project B authentication login test.",
    },
    {
        "wombat_id": "TC-SRCH-B-003",
        "title": "Payments retry project B",
        "tags": ["payments"],
        "body_text": "Project B payment retry scenario.",
    },
]


async def _setup_two_projects(db_session, async_engine, users):
    """Create projects A and B, seed them, give viewer user role on A only."""
    from wombat_api.database.models import UserProjectRoleDB

    slug_a = f"search-proj-a-{uuid.uuid4().hex[:6]}"
    slug_b = f"search-proj-b-{uuid.uuid4().hex[:6]}"

    project_a = await _create_and_seed_project(
        db_session, async_engine, slug_a, _PROJECT_A_TESTCASES
    )
    project_b = await _create_and_seed_project(
        db_session, async_engine, slug_b, _PROJECT_B_TESTCASES
    )

    # viewer user has role on project A ONLY
    viewer_user = users["viewer"]["user"]
    role_a = UserProjectRoleDB(
        user_id=viewer_user.id, project_id=project_a.id, role="viewer"
    )
    db_session.add(role_a)
    await db_session.commit()

    return project_a, project_b, slug_a, slug_b


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_semantic_search_returns_only_project_a_hits(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Semantic search returns hits ONLY from project A; no project B IDs."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    # Collect all project B content IDs for cross-check
    from sqlalchemy import select
    from wombat_api.database.models import Content
    from sqlalchemy.ext.asyncio import async_sessionmaker as _sm

    factory = _sm(async_engine, expire_on_commit=False)
    async with factory() as s:
        b_rows = (
            await s.execute(
                select(Content.id, Content.wombat_id).where(
                    Content.project_id == project_b.id
                )
            )
        ).all()
    b_ids = {str(r.id) for r in b_rows}
    b_wombat_ids = {r.wombat_id for r in b_rows}

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={"query": "refund", "mode": "semantic", "top_k": 10},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    assert len(hits) > 0

    # RBAC leakage check: no project B IDs appear
    hit_ids = {h["id"] for h in hits}
    hit_wombat_ids = {h.get("wombat_id") for h in hits if h.get("wombat_id")}
    assert not (hit_ids & b_ids), (
        f"RBAC LEAK: Project B IDs found in Project A search results: "
        f"{hit_ids & b_ids}"
    )
    assert not (hit_wombat_ids & b_wombat_ids), (
        f"RBAC LEAK: Project B wombat_ids found in results: "
        f"{hit_wombat_ids & b_wombat_ids}"
    )

    # Also verify source repo is from test-repo (project A's content)
    for hit in hits:
        assert hit["source"]["repo"] == "test-repo"


@pytest.mark.asyncio
async def test_hybrid_search_returns_only_project_a_hits(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Hybrid search (cosine + BM25) returns hits ONLY from project A."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    from sqlalchemy import select
    from wombat_api.database.models import Content
    from sqlalchemy.ext.asyncio import async_sessionmaker as _sm

    factory = _sm(async_engine, expire_on_commit=False)
    async with factory() as s:
        b_rows = (
            await s.execute(
                select(Content.id).where(Content.project_id == project_b.id)
            )
        ).all()
    b_ids = {str(r.id) for r in b_rows}

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={"query": "refund eligibility", "mode": "hybrid", "top_k": 10},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    assert len(hits) > 0

    hit_ids = {h["id"] for h in hits}
    assert not (hit_ids & b_ids), (
        f"RBAC LEAK: Project B IDs found in hybrid search: {hit_ids & b_ids}"
    )


@pytest.mark.asyncio
async def test_keyword_search_returns_only_project_a_hits(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Keyword search returns hits ONLY from project A."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    from sqlalchemy import select
    from wombat_api.database.models import Content
    from sqlalchemy.ext.asyncio import async_sessionmaker as _sm

    factory = _sm(async_engine, expire_on_commit=False)
    async with factory() as s:
        b_rows = (
            await s.execute(
                select(Content.id).where(Content.project_id == project_b.id)
            )
        ).all()
    b_ids = {str(r.id) for r in b_rows}

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={"query": "auth login", "mode": "keyword", "top_k": 10},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    # keyword mode: results may be empty if FTS doesn't match, but no B IDs
    hit_ids = {h["id"] for h in hits}
    assert not (hit_ids & b_ids), (
        f"RBAC LEAK: Project B IDs in keyword results: {hit_ids & b_ids}"
    )


@pytest.mark.asyncio
async def test_search_project_b_without_role_returns_403(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """A viewer of project A cannot search project B (403 RBAC enforcement)."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug_b}/search",
        json={"query": "refund", "mode": "semantic", "top_k": 5},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_top_k_is_honored(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Search with top_k=2 returns at most 2 hits."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={"query": "payments refund", "mode": "semantic", "top_k": 2},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    assert len(hits) <= 2


@pytest.mark.asyncio
async def test_kind_filter_testcase_only(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Search with kinds=['testcase'] returns only testcase hits."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )
    viewer_token = users["viewer"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={
            "query": "auth",
            "mode": "semantic",
            "kinds": ["testcase"],
            "top_k": 10,
        },
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp.status_code == 200
    hits = resp.json()["hits"]
    for hit in hits:
        assert hit["kind"] == "testcase", f"Expected testcase, got {hit['kind']}"


@pytest.mark.asyncio
async def test_unauthenticated_search_returns_401(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """Unauthenticated search request returns 401."""
    project_a, project_b, slug_a, slug_b = await _setup_two_projects(
        db_session, async_engine, users
    )

    resp = await httpx_client.post(
        f"/api/projects/{slug_a}/search",
        json={"query": "refund", "mode": "semantic", "top_k": 5},
    )
    assert resp.status_code == 401
