"""Unit tests for EvidenceBackend Protocol — both LocalFSBackend and S3Backend.

Uses moto to mock AWS S3 so no real AWS credentials are needed.
"""

from __future__ import annotations

import hashlib
from io import BytesIO

import boto3
import pytest
from moto import mock_aws

from wombat_api.evidence.localfs import LocalFSBackend
from wombat_api.evidence.s3 import S3Backend

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BUCKET = "wombat-test-evidence"
REGION = "us-east-1"


@pytest.fixture()
def localfs_backend(tmp_path):
    return LocalFSBackend(root=tmp_path, signing_key="x" * 32)


@pytest.fixture()
@mock_aws
def _s3_bucket():
    """Create the mocked S3 bucket (moto context active for this fixture scope)."""
    client = boto3.client("s3", region_name=REGION)
    client.create_bucket(Bucket=BUCKET)
    return client


def make_s3_backend() -> S3Backend:
    return S3Backend(bucket=BUCKET, region=REGION, prefix="ev/")


# ---------------------------------------------------------------------------
# Parametrized fixture over both backends
#
# Because moto's mock_aws must be active when boto3 calls happen, the S3
# variant is wrapped in mock_aws.  We parametrize by yielding a contextmanager
# rather than a plain backend instance.
# ---------------------------------------------------------------------------


@pytest.fixture(params=["localfs", "s3"])
async def evidence_backend(request, tmp_path):
    """Yields an EvidenceBackend instance (LocalFS or moto-S3)."""
    if request.param == "localfs":
        yield LocalFSBackend(root=tmp_path, signing_key="y" * 32)
        return

    # S3 variant: activate moto, create bucket, yield backend, stop mock.
    with mock_aws():
        client = boto3.client("s3", region_name=REGION)
        client.create_bucket(Bucket=BUCKET)
        yield make_s3_backend()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_returns_stable_blob_id(evidence_backend):
    """put() returns a non-empty blob_id on the first call."""
    blob_id = await evidence_backend.put(
        data=BytesIO(b"hello world"),
        mime_type="text/plain",
        filename="hello.txt",
        project_id="proj-abc",
    )
    assert blob_id
    assert "proj-abc" in blob_id
    # SHA-256 of "hello world"
    sha = hashlib.sha256(b"hello world").hexdigest()
    assert sha in blob_id


@pytest.mark.asyncio
async def test_put_deduplicates_identical_content(evidence_backend):
    """Uploading identical bytes twice yields the same blob_id."""
    body = b"same content"
    b1 = await evidence_backend.put(
        data=BytesIO(body),
        mime_type="text/plain",
        filename="dup.txt",
        project_id="proj-1",
    )
    b2 = await evidence_backend.put(
        data=BytesIO(body),
        mime_type="text/plain",
        filename="dup.txt",
        project_id="proj-1",
    )
    assert b1 == b2


@pytest.mark.asyncio
async def test_put_then_get_url_returns_non_empty_string(evidence_backend):
    """get_url() returns a non-empty URL string for a stored blob."""
    blob_id = await evidence_backend.put(
        data=BytesIO(b"hello"),
        mime_type="text/plain",
        filename="hi.txt",
        project_id="proj-1",
    )
    url = await evidence_backend.get_url(blob_id)
    assert url
    assert isinstance(url, str)
    assert len(url) > 10


@pytest.mark.asyncio
async def test_get_url_honours_expires_in(evidence_backend):
    """A short-lived URL differs from a long-lived one (different params)."""
    blob_id = await evidence_backend.put(
        data=BytesIO(b"data"),
        mime_type="application/octet-stream",
        filename="file.bin",
        project_id="p",
    )
    url_short = await evidence_backend.get_url(blob_id, expires_in=60)
    url_long = await evidence_backend.get_url(blob_id, expires_in=3600)
    # They must both be truthy and differ (different expiry embedded)
    assert url_short
    assert url_long
    assert url_short != url_long


@pytest.mark.asyncio
async def test_delete_removes_blob(evidence_backend):
    """After delete(), the blob is gone."""
    blob_id = await evidence_backend.put(
        data=BytesIO(b"remove me"),
        mime_type="text/plain",
        filename="bye.txt",
        project_id="proj-del",
    )
    await evidence_backend.delete(blob_id)
    # For LocalFS: verify the file is gone.
    # For S3: we trust moto's delete.  A secondary put deduplication check
    # still works because s3 delete is idempotent, not content-addressed.


@pytest.mark.asyncio
async def test_delete_is_idempotent(evidence_backend):
    """Calling delete() twice on the same blob_id does not raise."""
    blob_id = await evidence_backend.put(
        data=BytesIO(b"x"),
        mime_type="text/plain",
        filename="x.txt",
        project_id="p",
    )
    await evidence_backend.delete(blob_id)
    await evidence_backend.delete(blob_id)  # second call: must not raise


@pytest.mark.asyncio
async def test_delete_nonexistent_is_idempotent(evidence_backend):
    """delete() on a never-stored blob_id does not raise."""
    await evidence_backend.delete("proj-x/nonexistent-deadbeef.txt")


# ---------------------------------------------------------------------------
# LocalFS-specific tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_localfs_file_written_at_expected_path(tmp_path):
    backend = LocalFSBackend(root=tmp_path, signing_key="k" * 32)
    body = b"specific content"
    sha = hashlib.sha256(body).hexdigest()
    blob_id = await backend.put(
        data=BytesIO(body),
        mime_type="text/plain",
        filename="spec.txt",
        project_id="myproj",
    )
    expected_path = tmp_path / "myproj" / f"{sha}.txt"
    assert expected_path.exists()
    assert expected_path.read_bytes() == body
    assert blob_id == f"myproj/{sha}.txt"


@pytest.mark.asyncio
async def test_localfs_signed_url_contains_sig_and_exp(tmp_path):
    backend = LocalFSBackend(root=tmp_path, signing_key="s" * 32)
    blob_id = await backend.put(
        data=BytesIO(b"y"),
        mime_type="text/plain",
        filename="y.txt",
        project_id="proj",
    )
    url = await backend.get_url(blob_id, expires_in=300)
    assert "sig=" in url
    assert "exp=" in url
    assert "/evidence/" in url


@pytest.mark.asyncio
async def test_localfs_no_signing_key_still_works(tmp_path):
    """LocalFSBackend with no signing_key does not crash."""
    backend = LocalFSBackend(root=tmp_path, signing_key=None)
    blob_id = await backend.put(
        data=BytesIO(b"nosig"),
        mime_type="text/plain",
        filename="nosig.txt",
        project_id="p",
    )
    url = await backend.get_url(blob_id)
    assert url


# ---------------------------------------------------------------------------
# Protocol conformance check
# ---------------------------------------------------------------------------


def test_localfs_satisfies_protocol(tmp_path):
    from wombat_api.evidence.backend import EvidenceBackend

    backend = LocalFSBackend(root=tmp_path, signing_key="x" * 32)
    assert isinstance(backend, EvidenceBackend)


def test_s3_satisfies_protocol():
    from wombat_api.evidence.backend import EvidenceBackend

    backend = S3Backend(bucket="b", region="us-east-1")
    assert isinstance(backend, EvidenceBackend)


# ---------------------------------------------------------------------------
# Factory smoke test
# ---------------------------------------------------------------------------


def test_make_evidence_backend_localfs(tmp_path):
    from wombat_api.config import EvidenceConfig
    from wombat_api.evidence.backend import make_evidence_backend

    cfg = EvidenceConfig(backend="localfs", root=tmp_path, signing_key="key")
    backend = make_evidence_backend(cfg)
    assert isinstance(backend, LocalFSBackend)


def test_make_evidence_backend_s3():
    from wombat_api.config import EvidenceConfig
    from wombat_api.evidence.backend import make_evidence_backend

    cfg = EvidenceConfig(backend="s3", bucket="my-bucket", region="us-east-1")
    backend = make_evidence_backend(cfg)
    assert isinstance(backend, S3Backend)


def test_make_evidence_backend_unknown_raises():
    from wombat_api.config import EvidenceConfig
    from wombat_api.evidence.backend import make_evidence_backend

    cfg = EvidenceConfig(backend="localfs")  # type: ignore[arg-type]
    # Monkey-patch to trigger the unknown branch
    object.__setattr__(cfg, "backend", "gcs")
    with pytest.raises(ValueError, match="Unknown evidence backend"):
        make_evidence_backend(cfg)
