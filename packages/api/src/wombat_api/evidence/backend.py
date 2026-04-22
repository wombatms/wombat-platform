"""EvidenceBackend Protocol and factory function."""

from __future__ import annotations

from typing import TYPE_CHECKING, BinaryIO, Protocol, runtime_checkable

if TYPE_CHECKING:
    from wombat_api.config import EvidenceConfig


@runtime_checkable
class EvidenceBackend(Protocol):
    """Pluggable blob storage for evidence attachments.

    All implementations must be async-safe.  S3Backend wraps blocking boto3
    calls in ``asyncio.to_thread``; LocalFSBackend uses aiofiles-style writes
    via the same mechanism.

    Blob-id convention (both backends):
        ``"<project_id>/<sha256hex>.<ext>"``
    The prefix (for S3) is stored at write time and stripped from the blob_id
    so the caller always works with the short form.
    """

    async def put(
        self,
        *,
        data: BinaryIO,
        mime_type: str,
        filename: str,
        project_id: str,
    ) -> str:
        """Store *data* and return a stable ``blob_id``."""
        ...

    async def get_url(self, blob_id: str, expires_in: int = 300) -> str:
        """Return a presigned (or signed-app-server) GET URL.

        ``expires_in`` is in seconds; default 300 (5 minutes).
        """
        ...

    async def delete(self, blob_id: str) -> None:
        """Remove the blob.  Idempotent — no error if already gone."""
        ...


def make_evidence_backend(cfg: EvidenceConfig) -> EvidenceBackend:
    """Instantiate the backend selected by *cfg.backend*."""
    from wombat_api.evidence.localfs import LocalFSBackend
    from wombat_api.evidence.s3 import S3Backend

    if cfg.backend == "localfs":
        return LocalFSBackend(root=cfg.root, signing_key=cfg.signing_key)
    if cfg.backend == "s3":
        return S3Backend(
            bucket=cfg.bucket,
            region=cfg.region,
            endpoint_url=cfg.endpoint_url,
            prefix=cfg.prefix,
        )
    raise ValueError(f"Unknown evidence backend: {cfg.backend!r}")
