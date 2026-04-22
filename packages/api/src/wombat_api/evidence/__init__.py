"""Evidence subpackage — pluggable blob storage for run attachments."""

from wombat_api.evidence.backend import EvidenceBackend, make_evidence_backend
from wombat_api.evidence.localfs import LocalFSBackend
from wombat_api.evidence.s3 import S3Backend

__all__ = [
    "EvidenceBackend",
    "LocalFSBackend",
    "S3Backend",
    "make_evidence_backend",
]
