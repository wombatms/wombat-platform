"""LocalFSBackend — file-system evidence storage with HMAC-signed URLs."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import os
import time
from pathlib import Path
from typing import BinaryIO


class LocalFSBackend:
    """Stores blobs under ``<root>/<project_id>/<sha256hex>.<ext>``.

    ``get_url`` produces a signed URL that the evidence route (Task 21) will
    validate.  The URL format is::

        /evidence/{blob_id}/url?sig=<hmac_hex>&exp=<epoch_seconds>

    where ``blob_id`` is URL-encoded (the ``/`` replaced with ``%2F`` by
    clients, or kept as-is in the route path segment).

    HMAC message: ``"{blob_id}:{exp}"`` — SHA-256 keyed by *signing_key*.
    """

    def __init__(self, root: Path | str, signing_key: str | None = None) -> None:
        self._root = Path(root)
        self._signing_key = (signing_key or "").encode()

    # ------------------------------------------------------------------
    # Protocol implementation
    # ------------------------------------------------------------------

    async def put(
        self,
        *,
        data: BinaryIO,
        mime_type: str,
        filename: str,
        project_id: str,
    ) -> str:
        """Write *data* to disk; return ``blob_id``."""
        body = await asyncio.to_thread(data.read)
        blob_id = await asyncio.to_thread(
            self._write_bytes, body, filename, project_id
        )
        return blob_id

    async def get_url(self, blob_id: str, expires_in: int = 300) -> str:
        """Return a signed URL pointing at the local evidence route."""
        exp = int(time.time()) + expires_in
        sig = self._sign(blob_id, exp)
        # blob_id contains a "/" — the route uses a path parameter, so we
        # encode only the slash to keep the URL tidy for tests; production
        # routes match on the full blob_id path segment.
        encoded_id = blob_id.replace("/", "%2F")
        return f"/evidence/{encoded_id}/url?sig={sig}&exp={exp}"

    async def delete(self, blob_id: str) -> None:
        """Remove the file; idempotent."""
        path = self._blob_path(blob_id)
        await asyncio.to_thread(self._remove_if_exists, path)

    # ------------------------------------------------------------------
    # Internal helpers (sync; called via to_thread)
    # ------------------------------------------------------------------

    def _write_bytes(self, body: bytes, filename: str, project_id: str) -> str:
        sha = hashlib.sha256(body).hexdigest()
        ext = Path(filename).suffix.lstrip(".")  # "txt", "png", …
        blob_id = f"{project_id}/{sha}.{ext}" if ext else f"{project_id}/{sha}"
        dest = self._blob_path(blob_id)
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Write only if not already present (content-addressed deduplication).
        if not dest.exists():
            tmp = dest.with_suffix(dest.suffix + ".tmp")
            tmp.write_bytes(body)
            os.replace(tmp, dest)  # atomic on POSIX
        return blob_id

    def _blob_path(self, blob_id: str) -> Path:
        return self._root / blob_id

    def _remove_if_exists(self, path: Path) -> None:
        with contextlib.suppress(FileNotFoundError):
            path.unlink()

    def _sign(self, blob_id: str, exp: int) -> str:
        message = f"{blob_id}:{exp}".encode()
        return hmac.new(self._signing_key, message, hashlib.sha256).hexdigest()
