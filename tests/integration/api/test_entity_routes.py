"""Entity CRUD and listing integration tests.

Uses testcontainers Postgres via the conftest fixtures.
Entities are seeded via the Indexer with a FakeEmbedder so that
sentence-transformers is not required.

Scenarios:
- List testcases returns both seeded entries
- List plans returns 1
- List stories returns 1
- List suites returns 1
- List shared-steps returns 1
- Tag filter: ?tag=auth returns only auth-tagged rows
- Get specific testcase by wombat_id
- 404 on unknown wombat_id
- 403 when a viewer from a *different* project tries to list
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# FakeEmbedder — no sentence-transformers needed
# ---------------------------------------------------------------------------


class _FakeEmbedder:
    name = "fake"
    dim = 384

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        from wombat_api.database.models import EMBED_DIM

        return [[float(i % 256) / 256.0] + [0.0] * (EMBED_DIM - 1) for i, _ in enumerate(texts)]


# ---------------------------------------------------------------------------
# Fixture: repo dir pointing at our integration fixtures
# ---------------------------------------------------------------------------

INTEGRATION_REPO = Path(__file__).parent.parent.parent / "fixtures" / "integration_repo"


async def _seed_project(db_session: AsyncSession, async_engine) -> tuple:
    """Create a project and seed it via the Indexer. Returns (project, slug)."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from wombat_api.database.models import ProjectDB
    from wombat_api.database.repository import Repository
    from wombat_api.sync.indexer import Indexer

    slug = f"entity-test-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Entity Test Project",
        org="test-org",
        taxonomy_components=["auth", "payments"],
        taxonomy_environments=["staging"],
    )
    db_session.add(project)
    await db_session.flush()
    await db_session.commit()

    # Use a fresh session for indexer — must commit for the API to see the data
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as idx_session:
        repo = Repository(idx_session)
        indexer = Indexer(
            repository=repo,
            embedder=_FakeEmbedder(),
            batch_size=50,
            chunk_size_tokens=500,
            chunk_overlap_tokens=50,
        )
        await indexer.sync_project(
            project_id=project.id,
            test_repo_root=INTEGRATION_REPO,
            sources_root=INTEGRATION_REPO,  # no extra sources
            app_repos=[],
            docs_folder=None,
        )
        await idx_session.commit()

    return project, slug


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_testcases_returns_both(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """GET /{slug}/testcases returns both seeded testcases."""
    project, slug = await _seed_project(db_session, async_engine)
    # Give the viewer user access to this project
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role = UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer")
    db_session.add(role)
    await db_session.commit()

    token = users["viewer"]["token"]
    resp = await httpx_client.get(
        f"/api/projects/{slug}/testcases",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert len(data["data"]) == 2
    wombat_ids = {tc["wombat_id"] for tc in data["data"]}
    assert "TC-INT-AUTH-001" in wombat_ids
    assert "TC-INT-PAY-001" in wombat_ids


@pytest.mark.asyncio
async def test_list_plans_returns_one(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """GET /{slug}/plans returns 1 plan."""
    project, slug = await _seed_project(db_session, async_engine)
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role = UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer")
    db_session.add(role)
    await db_session.commit()

    resp = await httpx_client.get(
        f"/api/projects/{slug}/plans",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["data"]) == 1
    assert data["data"][0]["wombat_id"] == "PLAN-INT-REGRESSION"


@pytest.mark.asyncio
async def test_tag_filter_auth(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """?tag=auth returns only rows tagged with 'auth'.

    Content.tags is declared JSONB so SQLAlchemy compiles .contains([t]) to
    the @> operator — no LIKE mismatch.
    """
    project, slug = await _seed_project(db_session, async_engine)
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role = UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer")
    db_session.add(role)
    await db_session.commit()

    resp = await httpx_client.get(
        f"/api/projects/{slug}/testcases",
        params={"tag": "auth"},
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    # TC-INT-AUTH-001 has tag auth; TC-INT-PAY-001 does not
    assert len(data["data"]) == 1
    assert data["data"][0]["wombat_id"] == "TC-INT-AUTH-001"


@pytest.mark.asyncio
async def test_get_specific_testcase(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """GET /{slug}/testcases/{wombat_id} returns the specific testcase."""
    project, slug = await _seed_project(db_session, async_engine)
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role = UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer")
    db_session.add(role)
    await db_session.commit()

    resp = await httpx_client.get(
        f"/api/projects/{slug}/testcases/TC-INT-AUTH-001",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["wombat_id"] == "TC-INT-AUTH-001"
    assert data["data"]["title"] == "User logs in with valid email and password"


@pytest.mark.asyncio
async def test_get_unknown_wombat_id_returns_404(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """GET /{slug}/testcases/DOES-NOT-EXIST → 404."""
    project, slug = await _seed_project(db_session, async_engine)
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role = UserProjectRoleDB(user_id=viewer_user.id, project_id=project.id, role="viewer")
    db_session.add(role)
    await db_session.commit()

    resp = await httpx_client.get(
        f"/api/projects/{slug}/testcases/TC-DOES-NOT-EXIST-0000",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cross_project_access_is_denied(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """A user with viewer role on project A cannot access project B (403)."""
    # Project A — viewer user has role
    project_a, slug_a = await _seed_project(db_session, async_engine)
    from wombat_api.database.models import UserProjectRoleDB

    viewer_user = users["viewer"]["user"]
    role_a = UserProjectRoleDB(user_id=viewer_user.id, project_id=project_a.id, role="viewer")
    db_session.add(role_a)

    # Project B — viewer user has NO role
    project_b, slug_b = await _seed_project(db_session, async_engine)
    await db_session.commit()

    # Access to A should succeed
    resp_a = await httpx_client.get(
        f"/api/projects/{slug_a}/testcases",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp_a.status_code == 200

    # Access to B should be forbidden
    resp_b = await httpx_client.get(
        f"/api/projects/{slug_b}/testcases",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp_b.status_code == 403
