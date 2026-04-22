"""FastAPI dependency for the evidence backend.

Retrieves the configured ``EvidenceBackend`` instance from
``app.state.evidence_backend``, which is wired in the lifespan context in
``wombat_api.app``.

Usage::

    from wombat_api.evidence.deps import get_evidence_backend

    @router.post("/evidence")
    async def upload(
        backend: EvidenceBackend = Depends(get_evidence_backend),
    ) -> ...:
        ...
"""

from __future__ import annotations

from fastapi import Request

from wombat_api.evidence.backend import EvidenceBackend


def get_evidence_backend(request: Request) -> EvidenceBackend:
    """Return the process-wide ``EvidenceBackend`` from ``app.state``."""
    return request.app.state.evidence_backend  # type: ignore[no-any-return]
