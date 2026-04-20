"""Runs integration tests.

Scenarios:
- POST /runs creates a run; GET /runs/{id} returns it
- POST /runs/{id}/results:bulk with 3 results → assert row counts
- POST /runs/{id}/ingest with JSONL body → assert rows created
- GET /runs/{id} → run summary counters: total=3, passed=1, failed=1, blocked=1
- PATCH /runs/{id} updates status; GET reflects it
- Viewer role trying to POST /runs → 403
"""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


class _FakeEmbedder:
    name = "fake"
    dim = 384

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        from wombat_api.database.models import EMBED_DIM

        return [[0.0] * EMBED_DIM for _ in texts]


async def _seed_testcases(db_session: AsyncSession, async_engine, project_id) -> list[str]:
    """Seed 3 testcases and return their wombat_ids."""
    from sqlalchemy.ext.asyncio import async_sessionmaker as _sm

    from wombat_api.database.repository import Repository

    wombat_ids = ["TC-RUN-001", "TC-RUN-002", "TC-RUN-003"]
    factory = _sm(async_engine, expire_on_commit=False)
    async with factory() as s:
        repo = Repository(s)
        embedder = _FakeEmbedder()
        texts = [f"Test case {wid}" for wid in wombat_ids]
        vectors = await embedder.embed_batch(texts)

        for wid, vec in zip(wombat_ids, vectors, strict=False):
            await repo.upsert_content(
                project_id=project_id,
                kind="testcase",
                wombat_id=wid,
                title=f"Test case {wid}",
                tags=[],
                body={"summary": f"Summary for {wid}"},
                source_repo="test-repo",
                source_path=f"testcases/{wid.lower()}.md",
                source_revision="HEAD",
                embedding=vec,
            )
        await s.commit()

    return wombat_ids


@pytest.mark.asyncio
async def test_create_run(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """POST /runs creates a run; GET /runs/{id} returns it.

    Note: `users` fixture already seeds viewer/editor/admin roles on `seeded_project`.
    """
    project, slug = seeded_project
    # Roles already assigned by `users` fixture — no need to add them again

    editor_token = users["editor"]["token"]
    auth_headers = {"Authorization": f"Bearer {editor_token}"}

    resp = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "Integration Run 1", "environment": "staging", "source": "api"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    run_data = resp.json()["data"]
    run_id = run_data["id"]
    assert run_data["title"] == "Integration Run 1"
    assert run_data["status"] == "pending"

    # GET run
    get_resp = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers=auth_headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["data"]["id"] == run_id


@pytest.mark.asyncio
async def test_bulk_results_and_summary(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """POST /results:bulk with 3 results, then GET /runs/{id} returns summary counters."""
    project, slug = seeded_project
    wombat_ids = await _seed_testcases(db_session, async_engine, project.id)
    # Roles already assigned by `users` fixture

    editor_token = users["editor"]["token"]
    auth_headers = {"Authorization": f"Bearer {editor_token}"}

    # Create run
    run_resp = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "Bulk Results Run", "source": "api"},
        headers=auth_headers,
    )
    assert run_resp.status_code == 201
    run_id = run_resp.json()["data"]["id"]

    # Bulk ingest: 1 pass, 1 fail, 1 block
    bulk_resp = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results:bulk",
        json=[
            {"testcase_id": wombat_ids[0], "status": "pass", "duration_ms": 1000},
            {"testcase_id": wombat_ids[1], "status": "fail", "duration_ms": 2000, "notes": "Bug found"},
            {"testcase_id": wombat_ids[2], "status": "block", "duration_ms": None},
        ],
        headers=auth_headers,
    )
    assert bulk_resp.status_code == 201
    bulk_data = bulk_resp.json()["data"]
    assert bulk_data["created"] == 3

    # GET run with summary
    get_resp = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers=auth_headers,
    )
    assert get_resp.status_code == 200
    summary = get_resp.json()["data"]["summary"]
    assert summary["total"] == 3
    assert summary["passed"] == 1
    assert summary["failed"] == 1
    assert summary["blocked"] == 1


@pytest.mark.asyncio
async def test_jsonl_ingest(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """POST /ingest with JSONL body creates result rows."""
    project, slug = seeded_project
    wombat_ids = await _seed_testcases(db_session, async_engine, project.id)
    # Roles already assigned by `users` fixture

    editor_token = users["editor"]["token"]
    auth_headers = {"Authorization": f"Bearer {editor_token}"}

    # Create run
    run_resp = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "JSONL Ingest Run", "source": "api"},
        headers=auth_headers,
    )
    run_id = run_resp.json()["data"]["id"]

    # Build JSONL body
    jsonl_body = "\n".join(
        [
            json.dumps({"testcase_id": wombat_ids[0], "status": "pass"}),
            json.dumps({"testcase_id": wombat_ids[1], "status": "fail"}),
            json.dumps({"testcase_id": wombat_ids[2], "status": "skip"}),
        ]
    )

    ingest_resp = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/ingest",
        content=jsonl_body.encode("utf-8"),
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert ingest_resp.status_code == 201
    ingest_data = ingest_resp.json()["data"]
    assert ingest_data["created"] == 3
    assert ingest_data["total_lines"] == 3
    assert ingest_data["parse_errors"] == 0


@pytest.mark.asyncio
async def test_patch_run_status(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """PATCH /runs/{id} updates status; GET reflects the change."""
    project, slug = seeded_project
    # Roles already assigned by `users` fixture

    editor_token = users["editor"]["token"]
    auth_headers = {"Authorization": f"Bearer {editor_token}"}

    # Create run
    run_resp = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "Status Update Run", "source": "api"},
        headers=auth_headers,
    )
    run_id = run_resp.json()["data"]["id"]

    # Patch status to completed
    patch_resp = await httpx_client.patch(
        f"/api/projects/{slug}/runs/{run_id}",
        json={"status": "passed"},
        headers=auth_headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["data"]["status"] == "passed"

    # GET confirms
    get_resp = await httpx_client.get(
        f"/api/projects/{slug}/runs/{run_id}",
        headers=auth_headers,
    )
    assert get_resp.json()["data"]["status"] == "passed"


@pytest.mark.asyncio
async def test_viewer_cannot_create_run(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """A viewer role cannot POST /runs (requires editor+)."""
    project, slug = seeded_project
    # Roles already assigned by `users` fixture — viewer has 'viewer' role

    resp = await httpx_client.post(
        f"/api/projects/{slug}/runs",
        json={"title": "Should Fail", "source": "api"},
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_runs(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    async_engine,
    users,
    seeded_project,
):
    """GET /runs returns a paginated list of runs."""
    project, slug = seeded_project
    # Roles already assigned by `users` fixture

    editor_token = users["editor"]["token"]
    auth_headers = {"Authorization": f"Bearer {editor_token}"}

    # Create 2 runs
    for i in range(2):
        await httpx_client.post(
            f"/api/projects/{slug}/runs",
            json={"title": f"List Run {i}", "source": "api"},
            headers=auth_headers,
        )

    resp = await httpx_client.get(
        f"/api/projects/{slug}/runs",
        headers={"Authorization": f"Bearer {users['viewer']['token']}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert len(data["data"]) >= 2
