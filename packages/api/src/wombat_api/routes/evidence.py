"""Evidence routes — signed URL endpoint and LocalFS blob-serving handler.

The upload and delete endpoints live in routes/runs.py because they are nested
under the run → result path.  This module provides:

1. ``GET /api/evidence/{evidence_id}/url`` — returns presigned {url, expires_at}
   metadata; project-agnostic in URL shape.  Auth is intentionally skipped for
   now (the signed URL provides the security boundary).

2. ``GET /evidence/{blob_path:path}/url`` — LocalFS blob-serving handler.
   Validates the HMAC sig+exp produced by LocalFSBackend.get_url() and streams
   the file bytes back.  S3 presigned URLs bypass this route entirely (they
   point to S3/moto directly).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import time
import uuid as _uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ResultDB, RunDB
from wombat_api.database.repository import Repository
from wombat_api.evidence.deps import get_evidence_backend
from wombat_api.runs.schemas import EvidencePresignResponse

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /api/evidence/{evidence_id}/url — return presigned URL metadata
# ---------------------------------------------------------------------------


@router.get("/api/evidence/{evidence_id}/url")
async def get_evidence_url(
    evidence_id: str,
    session: AsyncSession = Depends(get_session),
    backend=Depends(get_evidence_backend),
):
    """Return a presigned URL for the given evidence record.

    Joins evidence → result → run → project to verify the evidence exists.
    Returns {url, expires_at}.

    NOTE: Auth is intentionally omitted here — the signed URL itself (for
    LocalFS: HMAC sig+exp; for S3: AWS presigned URL) is the security boundary.
    A future iteration can plumb proper RUNS_READ auth once the endpoint URL
    moves under /projects/{slug}.
    """
    try:
        eid = _uuid.UUID(evidence_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"}) from exc

    repo = Repository(session)
    evidence_row = await repo.get_evidence(eid)
    if evidence_row is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    result = await session.get(ResultDB, evidence_row.result_id)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    run = await session.get(RunDB, result.run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"code": "evidence_not_found"})

    expires_in = 300  # 5 minutes
    url = await backend.get_url(evidence_row.blob_id, expires_in=expires_in)
    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)

    return EvidencePresignResponse(url=url, expires_at=expires_at).model_dump(mode="json")


# ---------------------------------------------------------------------------
# GET /evidence/{blob_path:path}/url — LocalFS blob-serving handler
#
# This route is only meaningful when the evidence backend is LocalFSBackend.
# The URL format produced by LocalFSBackend.get_url() is:
#   /evidence/{project_id}%2F{sha256hex}.{ext}/url?sig=<hmac_hex>&exp=<epoch>
#
# The handler:
#   1. URL-decodes blob_path (restoring the "/" in project_id/sha256.ext).
#   2. Validates that the HMAC sig matches and expiry has not passed.
#   3. Reads the file from the LocalFSBackend's root and returns the bytes.
#
# For S3-backed deployments this route will never be hit because S3 presigned
# URLs point directly to S3 / the moto endpoint.
# ---------------------------------------------------------------------------


@router.get("/evidence/{blob_path:path}/url")
async def serve_localfs_blob(
    blob_path: str,
    sig: str = Query(...),
    exp: int = Query(...),
    backend=Depends(get_evidence_backend),
):
    """Serve a LocalFS evidence blob after HMAC signature validation.

    This endpoint is the "download" counterpart to LocalFSBackend.get_url().
    It is intentionally unauthenticated — the HMAC signature (keyed by the
    signing_key configured for the LocalFSBackend) acts as the bearer credential.

    Args:
        blob_path: URL-decoded blob identifier, e.g. ``{project_id}/{sha}.ext``.
        sig: HMAC-SHA256 hex digest of ``"{blob_id}:{exp}"``.
        exp: Unix epoch seconds at which the URL expires.
    """
    from wombat_api.evidence.localfs import LocalFSBackend

    if not isinstance(backend, LocalFSBackend):
        # S3 presigned URLs don't come through here; if misconfigured, 404.
        raise HTTPException(status_code=404, detail={"code": "not_localfs_backend"})

    # Decode any percent-encoding in the path (FastAPI preserves %2F as-is in
    # path parameters when using {param:path}).
    blob_id = unquote(blob_path)

    # Validate expiry first (cheap check before HMAC).
    if int(time.time()) > exp:
        raise HTTPException(status_code=410, detail={"code": "evidence_url_expired"})

    # Validate HMAC signature.
    message = f"{blob_id}:{exp}".encode()
    signing_key = backend._signing_key  # bytes; set in __init__
    expected_sig = hmac.new(signing_key, message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        raise HTTPException(status_code=403, detail={"code": "evidence_sig_invalid"})

    # Resolve path and read the file.
    blob_path_on_disk: Path = backend._root / blob_id
    if not blob_path_on_disk.is_file():
        raise HTTPException(status_code=404, detail={"code": "evidence_blob_not_found"})

    body = await asyncio.to_thread(blob_path_on_disk.read_bytes)

    # Infer content-type from extension.
    ext = blob_path_on_disk.suffix.lower()
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".bin": "application/octet-stream",
    }
    content_type = mime_map.get(ext, "application/octet-stream")

    return Response(content=body, media_type=content_type)
