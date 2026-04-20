"""End-to-end happy path test — Task 38.

Exercises the full pipeline in-process:

1. Seed a project + admin user in the test Postgres DB.
2. Create a temp test-repo dir with 2 testcases + 1 refund-policy doc.
3. Call Indexer.sync_project with FakeEmbedder (no sentence-transformers).
4. Assert: Content rows, ContentChunk rows, non-null embeddings, source_revision set.
5. POST /api/projects/{slug}/search via ASGITransport — assert refund doc hit.
6. Call hybrid_search directly (mirrors ``wombat rag preview`` local mode).
7. Call the MCP api:search_content handler directly (via respx mock of httpx).

All HTTP calls use httpx.AsyncClient(transport=ASGITransport(app)) — no
subprocess uvicorn is needed.

Embedder: FakeEmbedder (deterministic unit vectors, 384-dim).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
import respx
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# ---------------------------------------------------------------------------
# FakeEmbedder
# ---------------------------------------------------------------------------


class _FakeEmbedder:
    """Deterministic embedder — no sentence-transformers dependency."""

    name = "fake"
    dim = 384

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        from wombat_api.database.models import EMBED_DIM

        result = []
        for i, text in enumerate(texts):
            # Each vector: first element encodes the text length modulo 1.0,
            # rest are zeros.  Distinct enough for cosine to rank them.
            seed = (len(text) + i * 17) % 256
            vec = [seed / 256.0] + [0.0] * (EMBED_DIM - 1)
            result.append(vec)
        return result


_FAKE_EMBEDDER = _FakeEmbedder()


# ---------------------------------------------------------------------------
# Fixtures: patch the search-route embedder with FakeEmbedder
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(autouse=True)
async def _patch_search_embedder():
    """Patch search route embedder globally for this module."""
    import wombat_api.routes.search as _search_mod

    orig = _search_mod._embedder
    _search_mod._embedder = _FAKE_EMBEDDER
    with patch.object(_search_mod, "_get_embedder", return_value=_FAKE_EMBEDDER):
        yield
    _search_mod._embedder = orig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REFUND_POLICY_TEXT = """\
# Refund Policy

## Eligibility

Customers may request a refund within 30 days of purchase if the product is
defective, not as described, or if they have changed their mind.  Refund
eligibility is determined at the time of the refund request.  All refund
requests must be submitted through the official refund portal.

## How to request a refund

To request a refund, customers must log in to their account and navigate to
the Order History section.  From there, select the relevant order and click
the Request Refund button.

1. Contact customer support at support@example.com.
2. Provide your order number and reason for refund.
3. Our team will review your request within 2 business days.
4. You will receive an email notification with the decision.

## Non-refundable items

Digital downloads, gift cards, and custom-made products are not eligible for
refunds.  Shipping costs are also non-refundable.  Sale items purchased at a
discount greater than 50% are also excluded from the refund policy.

## Partial refunds

In some cases a partial refund may be issued, for example if the product is
returned in a used or damaged condition.  Partial refunds are calculated
based on the condition of the returned item and any applicable restocking fees.

## Refund processing time

Approved refunds are processed within 5 to 10 business days to the original
payment method.  Customers will receive a confirmation email once the refund
has been issued.  International refunds may take longer depending on the
payment provider and applicable currency conversion fees.

## Disputes and escalations

If a refund request is denied, customers may escalate the dispute by contacting
our billing team at billing@example.com.  All disputes must be submitted within
60 days of the original purchase date.  Our legal team handles escalations that
cannot be resolved through standard customer support channels.
"""


def _make_temp_repo(tmp_path: Path) -> Path:
    """Create a minimal test-repo layout in tmp_path.

    Layout:
        testcases/tc-e2e-auth-001.md
        testcases/tc-e2e-pay-001.md
        docs/refund-policy.md
    """
    repo = tmp_path / "e2e-repo"
    repo.mkdir()

    (repo / "testcases").mkdir()
    (repo / "docs").mkdir()

    (repo / "testcases" / "tc-e2e-auth-001.md").write_text(
        """\
---
id: TC-E2E-AUTH-001
title: User logs in with valid email and password
summary: Verify that a registered user can authenticate successfully.
status: active
priority: high
type: functional
component: auth
owner: qa-team
tags:
  - auth
  - login
steps:
  - number: 1
    action: Navigate to /login
    expected: Login page loads
  - number: 2
    action: Enter valid credentials
    expected: Fields populated
version: 1
---

Verify the standard login flow.
""",
        encoding="utf-8",
    )

    (repo / "testcases" / "tc-e2e-pay-001.md").write_text(
        """\
---
id: TC-E2E-PAY-001
title: Refund eligibility check for completed orders
summary: Verify that refund eligibility is determined correctly for completed orders.
status: active
priority: critical
type: functional
component: payments
owner: qa-payments
tags:
  - payments
  - refund
steps:
  - number: 1
    action: Navigate to order history
    expected: Orders list loads
  - number: 2
    action: Click Request Refund
    expected: Refund eligibility modal opens
version: 1
---

Refund eligibility test for the payments component.
""",
        encoding="utf-8",
    )

    (repo / "docs" / "refund-policy.md").write_text(
        _REFUND_POLICY_TEXT,
        encoding="utf-8",
    )

    return repo


async def _create_project_and_user(db_session: AsyncSession) -> tuple:
    """Return (project, admin_token, slug)."""
    from wombat_api.auth.jwt import create_access_token
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import ProjectDB, UserDB, UserProjectRoleDB

    slug = f"e2e-happy-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="E2E Happy Path Project",
        org="test-org",
        taxonomy_components=["auth", "payments"],
        taxonomy_environments=["staging"],
    )
    db_session.add(project)
    await db_session.flush()

    email = f"e2e-admin-{uuid.uuid4().hex[:6]}@test.example"
    user = UserDB(
        email=email,
        hashed_password=hash_password("E2EPass123!"),
        display_name="E2E Admin",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    role = UserProjectRoleDB(
        user_id=user.id,
        project_id=project.id,
        role="admin",
    )
    db_session.add(role)
    await db_session.flush()
    await db_session.commit()

    token = create_access_token(user.id, email)
    return project, token, slug


# ---------------------------------------------------------------------------
# Main E2E test
# ---------------------------------------------------------------------------


@pytest.mark.slow
@pytest.mark.asyncio
async def test_e2e_happy_path(
    tmp_path: Path,
    async_engine,
    db_session: AsyncSession,
):
    """Full end-to-end happy path exercising indexing, search, CLI, and MCP."""

    # ------------------------------------------------------------------
    # Step 1: Seed project + admin user
    # ------------------------------------------------------------------
    project, admin_token, slug = await _create_project_and_user(db_session)
    assert project.id is not None
    assert slug.startswith("e2e-happy-")

    # ------------------------------------------------------------------
    # Step 2: Create temp test-repo with 2 testcases + 1 refund doc
    # ------------------------------------------------------------------
    repo_dir = _make_temp_repo(tmp_path)
    assert (repo_dir / "testcases" / "tc-e2e-auth-001.md").exists()
    assert (repo_dir / "testcases" / "tc-e2e-pay-001.md").exists()
    assert (repo_dir / "docs" / "refund-policy.md").exists()

    # ------------------------------------------------------------------
    # Step 3: Sync via Indexer with FakeEmbedder
    # ------------------------------------------------------------------
    from wombat_api.database.repository import Repository
    from wombat_api.sync.indexer import Indexer

    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as sync_session:
        repo = Repository(sync_session)
        indexer = Indexer(
            repository=repo,
            embedder=_FAKE_EMBEDDER,
            batch_size=10,
            chunk_size_tokens=100,  # small so the ~300-word refund doc gets chunked
            chunk_overlap_tokens=10,
        )
        progress = await indexer.sync_project(
            project_id=project.id,
            test_repo_root=repo_dir,
            sources_root=tmp_path / "sources",
            app_repos=[],
            docs_folder="docs",
        )
        # The indexer flushes but does not commit; the session owner commits.
        await sync_session.commit()

    assert progress.errors == [], f"Indexer errors: {progress.errors}"
    assert progress.total >= 3, f"Expected at least 3 files, got {progress.total}"
    assert progress.embedded >= 3, f"Expected at least 3 embedded, got {progress.embedded}"

    # ------------------------------------------------------------------
    # Step 4: Verify DB state
    # ------------------------------------------------------------------
    from sqlalchemy import func as sa_func
    from sqlalchemy import select

    from wombat_api.database.models import Content, ContentChunk

    async with factory() as verify_session:
        # Count content rows per kind
        rows = (
            await verify_session.execute(
                select(Content.kind, sa_func.count(Content.id).label("cnt"))
                .where(Content.project_id == project.id)
                .where(Content.deleted_at.is_(None))
                .group_by(Content.kind)
            )
        ).all()
        kind_counts = {r.kind: r.cnt for r in rows}

        assert kind_counts.get("testcase", 0) == 2, f"Expected 2 testcases, got {kind_counts}"
        assert kind_counts.get("doc", 0) == 1, f"Expected 1 doc, got {kind_counts}"

        # Verify all testcases have embeddings and source_revision set
        tc_rows = (
            (
                await verify_session.execute(
                    select(Content).where(Content.project_id == project.id).where(Content.kind == "testcase")
                )
            )
            .scalars()
            .all()
        )

        for tc in tc_rows:
            assert tc.embedding is not None, f"Testcase {tc.wombat_id} has no embedding"
            assert tc.source_revision not in (None, ""), f"Testcase {tc.wombat_id} has no source_revision"

        # Verify doc has ContentChunk rows (refund policy is long enough to chunk)
        doc_row = (
            await verify_session.execute(
                select(Content).where(Content.project_id == project.id).where(Content.kind == "doc")
            )
        ).scalar_one()

        chunk_count = (
            await verify_session.execute(
                select(sa_func.count(ContentChunk.id)).where(ContentChunk.content_id == doc_row.id)
            )
        ).scalar_one()

        assert chunk_count >= 1, f"Expected at least 1 chunk for refund-policy doc, got {chunk_count}"

        # Verify chunks have non-null embeddings
        chunks = (
            (await verify_session.execute(select(ContentChunk).where(ContentChunk.content_id == doc_row.id)))
            .scalars()
            .all()
        )

        for chunk in chunks:
            assert chunk.embedding is not None, "Chunk has no embedding"

    # ------------------------------------------------------------------
    # Step 5: Search via ASGITransport — assert refund/payment hit
    # ------------------------------------------------------------------
    from wombat_api.app import create_app
    from wombat_api.database.engine import get_session

    app = create_app()
    test_factory = async_sessionmaker(async_engine, expire_on_commit=False)

    async def _override_get_session():
        async with test_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            f"/api/projects/{slug}/search",
            json={
                "query": "refund eligibility",
                "mode": "hybrid",
                "top_k": 10,
                "include_chunks": True,
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )

    assert resp.status_code == 200, f"Search returned {resp.status_code}: {resp.text}"
    search_resp = resp.json()
    hits = search_resp["hits"]
    assert len(hits) >= 1, "Expected at least one search hit for 'refund eligibility'"

    # At least one hit should be a doc or testcase with refund/payment relevance
    hit_kinds = {h["kind"] for h in hits}
    hit_wombat_ids = {h.get("wombat_id") for h in hits if h.get("wombat_id")}
    hit_titles = [h.get("title", "") for h in hits]

    assert hit_kinds & {"doc", "testcase"}, f"Expected doc or testcase hits, got kinds: {hit_kinds}"

    # At least one result should be refund-related
    refund_hits = [
        h for h in hits if "refund" in (h.get("title") or "").lower() or "refund" in (h.get("wombat_id") or "").lower()
    ]
    assert len(refund_hits) >= 1, (
        f"Expected at least 1 refund-related hit.\nAll hit titles: {hit_titles}\nAll wombat_ids: {hit_wombat_ids}"
    )

    # ------------------------------------------------------------------
    # Step 6: CLI local preview (mirrors _local_preview internals)
    # ------------------------------------------------------------------
    async with factory() as cli_session:
        from sqlalchemy import select as sa_select

        from wombat_api.database.models import ProjectDB
        from wombat_api.search.hybrid import hybrid_search

        # Re-embed the query with the same FakeEmbedder
        query = "refund eligibility"
        vecs = await _FAKE_EMBEDDER.embed_batch([query])
        q_vec = vecs[0]

        # Resolve slug → project
        proj_row = (await cli_session.execute(sa_select(ProjectDB).where(ProjectDB.slug == slug))).scalar_one()

        cli_hits = await hybrid_search(
            cli_session,
            project_id=proj_row.id,
            query=query,
            query_embedding=q_vec,
            kinds=None,
            top_k=10,
            mode="hybrid",
            include_chunks=True,
        )

    assert len(cli_hits) >= 1, "CLI local preview returned no hits for 'refund eligibility'"
    cli_refund_hits = [
        h
        for h in cli_hits
        if "refund" in (h.get("title") or "").lower() or "refund" in (h.get("wombat_id") or "").lower()
    ]
    assert len(cli_refund_hits) >= 1, f"CLI hits had no refund-related results: {[h.get('title') for h in cli_hits]}"

    # ------------------------------------------------------------------
    # Step 7: MCP api:search_content via respx mock
    # ------------------------------------------------------------------
    # The MCP tool uses httpx.AsyncClient to call the API.
    # We mock it with respx to return the same response shape.
    mock_hits = [
        {
            "id": str(uuid.uuid4()),
            "kind": "testcase",
            "wombat_id": "TC-E2E-PAY-001",
            "title": "Refund eligibility check for completed orders",
            "score": 0.95,
            "source": {"repo": "test-repo", "path": "testcases/tc-e2e-pay-001.md"},
        }
    ]
    mock_response = {"hits": mock_hits, "query": "refund eligibility", "mode": "hybrid"}

    import os

    with respx.mock:
        respx.post(f"http://localhost:8000/api/projects/{slug}/search").mock(
            return_value=httpx.Response(200, json=mock_response)
        )

        with patch.dict(
            os.environ,
            {"WOMBAT_API_URL": "http://localhost:8000", "WOMBAT_API_TOKEN": admin_token},
        ):
            from wombat_mcp.tools import build_tool_registry

            registry = build_tool_registry("api")
            mcp_result = await registry.call(
                "api:search_content",
                {
                    "project": slug,
                    "query": "refund eligibility",
                    "mode": "hybrid",
                    "top_k": 10,
                },
            )

    assert "hits" in mcp_result, f"MCP result missing 'hits': {mcp_result}"
    assert len(mcp_result["hits"]) >= 1, "MCP result has no hits"
    assert mcp_result["hits"][0]["wombat_id"] == "TC-E2E-PAY-001"
    mcp_kinds = {h["kind"] for h in mcp_result["hits"]}
    assert "testcase" in mcp_kinds, f"Expected testcase in MCP hits, got: {mcp_kinds}"
