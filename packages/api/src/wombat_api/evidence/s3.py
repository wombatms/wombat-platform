"""S3Backend — evidence storage via boto3 (AWS S3 / MinIO / Cloudflare R2)."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import BinaryIO


class S3Backend:
    """Stores blobs in an S3-compatible bucket.

    Blob-id convention: ``"<project_id>/<sha256hex>.<ext>"`` — the *prefix*
    is prepended at storage time and stripped for external references so the
    caller always handles the short form.

    Credentials are read from the environment by boto3 using the standard
    chain (``AWS_ACCESS_KEY_ID`` / ``AWS_SECRET_ACCESS_KEY`` / instance
    profile / …).
    """

    def __init__(
        self,
        bucket: str,
        region: str | None = None,
        endpoint_url: str | None = None,
        prefix: str = "evidence/",
    ) -> None:
        self._bucket = bucket
        self._region = region
        self._endpoint_url = endpoint_url
        # Normalise prefix: always ends with "/"
        self._prefix = prefix.rstrip("/") + "/" if prefix else ""
        self.__client = None  # lazy init; boto3 is optional at import time

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
        """Upload *data* and return ``blob_id``."""
        body = await asyncio.to_thread(data.read)
        sha = hashlib.sha256(body).hexdigest()
        ext = Path(filename).suffix.lstrip(".")
        blob_id = f"{project_id}/{sha}.{ext}" if ext else f"{project_id}/{sha}"
        key = self._key(blob_id)
        client = self._client()
        await asyncio.to_thread(
            client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType=mime_type,
        )
        return blob_id

    async def get_url(self, blob_id: str, expires_in: int = 300) -> str:
        """Return a presigned S3 GET URL valid for *expires_in* seconds."""
        client = self._client()
        key = self._key(blob_id)
        url: str = await asyncio.to_thread(
            client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )
        return url

    async def delete(self, blob_id: str) -> None:
        """Delete the object; idempotent (S3 delete is no-op if missing)."""
        client = self._client()
        key = self._key(blob_id)
        await asyncio.to_thread(
            client.delete_object,
            Bucket=self._bucket,
            Key=key,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _key(self, blob_id: str) -> str:
        return f"{self._prefix}{blob_id}"

    def _client(self):  # type: ignore[return]
        """Return a (cached) boto3 S3 client, creating it lazily."""
        if self.__client is None:
            import boto3  # noqa: PLC0415  (deferred import; boto3 is optional)

            kwargs: dict = {}
            if self._region:
                kwargs["region_name"] = self._region
            if self._endpoint_url:
                kwargs["endpoint_url"] = self._endpoint_url
            self.__client = boto3.client("s3", **kwargs)
        return self.__client
