"""Smoke tests for Task 21: evidence upload + signed URL + delete routes.

Uses LocalFSBackend pointed at a tmp dir via dependency_overrides on
app.state.evidence_backend.
"""

from __future__ import annotations

import io

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Fixture: override evidence backend to use tmp_path
# ---------------------------------------------------------------------------


@pytest.fixture
def evidence_backend_override(tmp_path):
    """Instantiate a LocalFSBackend pointing at a pytest tmp_path."""
    from wombat_api.evidence.localfs import LocalFSBackend

    return LocalFSBackend(root=tmp_path, signing_key="test-secret")


# ---------------------------------------------------------------------------
# Helper: record a result so evidence can attach to it
# ---------------------------------------------------------------------------


async def _record_result(
    client: AsyncClient,
    slug: str,
    run_id: str,
    case_id: str,
    token: str,
) -> None:
    r = await client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {token}"},
        json=[{"case_id": case_id, "status": "pass"}],
    )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Task 21: upload + signed URL + delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_get_url_delete(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    run_with_1_case,
    evidence_backend_override,
    tmp_path,
):
    """Upload evidence → get signed URL → delete."""
    from wombat_api.evidence.deps import get_evidence_backend
    from wombat_api.app import create_app
    from wombat_api.database.engine import get_session
    import wombat_api.database.engine as _engine_mod
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from httpx import ASGITransport, AsyncClient as _AsyncClient

    app = create_app()

    # Override evidence backend + session
    app.dependency_overrides[get_evidence_backend] = lambda: evidence_backend_override
    test_factory = async_sessionmaker(_engine_mod.engine, expire_on_commit=False)

    async def _override_session():
        async with test_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with _AsyncClient(transport=transport, base_url="http://test") as client:
        editor_token = users["editor"]["token"]
        slug = run_with_1_case.project_slug
        run_id = run_with_1_case.id
        case_id = run_with_1_case.case_ids[0]

        # Must have a result first
        await _record_result(client, slug, run_id, case_id, editor_token)

        # Upload evidence
        r = await client.post(
            f"/api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence",
            headers={"Authorization": f"Bearer {editor_token}"},
            files={"file": ("screenshot.png", b"fake png bytes", "image/png")},
        )
        assert r.status_code == 201, r.text
        eid = r.json()["data"]["id"]
        assert r.json()["data"]["filename"] == "screenshot.png"
        assert r.json()["data"]["size_bytes"] == len(b"fake png bytes")

        # Get signed URL
        u = await client.get(
            f"/api/evidence/{eid}/url",
            headers={"Authorization": f"Bearer {editor_token}"},
        )
        assert u.status_code == 200, u.text
        assert "url" in u.json()
        assert "expires_at" in u.json()

        # Delete evidence
        d = await client.delete(
            f"/api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence/{eid}",
            headers={"Authorization": f"Bearer {editor_token}"},
        )
        assert d.status_code == 204, d.text


@pytest.mark.asyncio
async def test_upload_evidence_too_large(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
    tmp_path,
):
    """Upload exceeding max_file_mb returns 413 evidence_too_large."""
    from wombat_api.evidence.localfs import LocalFSBackend
    from wombat_api.evidence.deps import get_evidence_backend
    from wombat_api.app import create_app
    from wombat_api.database.engine import get_session
    import wombat_api.database.engine as _engine_mod
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from httpx import ASGITransport, AsyncClient as _AsyncClient

    app = create_app()
    backend = LocalFSBackend(root=tmp_path, signing_key="test-secret")
    app.dependency_overrides[get_evidence_backend] = lambda: backend
    test_factory = async_sessionmaker(_engine_mod.engine, expire_on_commit=False)

    async def _override_session():
        async with test_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_session

    # Patch config to have a tiny max
    from wombat_api import config as _cfg_mod
    original_get_config = _cfg_mod.get_config

    def _tiny_config():
        from wombat_api.config import Config, EvidenceConfig
        from pathlib import Path
        ev_cfg = EvidenceConfig(backend="localfs", root=tmp_path, max_file_mb=1)
        return Config(
            database_url="postgresql+asyncpg://x:x@localhost/x",
            jwt_secret="test",
            evidence=ev_cfg,
        )

    _cfg_mod.get_config = _tiny_config  # type: ignore[assignment]

    transport = ASGITransport(app=app)
    async with _AsyncClient(transport=transport, base_url="http://test") as client:
        editor_token = users["editor"]["token"]
        slug = run_with_1_case.project_slug
        run_id = run_with_1_case.id
        case_id = run_with_1_case.case_ids[0]

        # Record a result first
        await _record_result(client, slug, run_id, case_id, editor_token)

        # 2 MB of zeros — exceeds the 1 MB cap
        big_file = b"\x00" * (2 * 1_048_576)
        r = await client.post(
            f"/api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence",
            headers={"Authorization": f"Bearer {editor_token}"},
            files={"file": ("huge.bin", big_file, "application/octet-stream")},
        )
        assert r.status_code == 413, r.text
        assert r.json()["error"]["code"] == "evidence_too_large"

    # Restore
    _cfg_mod.get_config = original_get_config  # type: ignore[assignment]


@pytest.mark.asyncio
async def test_upload_evidence_unauth(
    httpx_client: AsyncClient,
    run_with_1_case,
):
    """Unauthenticated evidence upload returns 401."""
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence",
        files={"file": ("f.png", b"data", "image/png")},
    )
    assert r.status_code == 401
