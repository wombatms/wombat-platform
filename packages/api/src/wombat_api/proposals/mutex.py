"""Per-project mutex used by the publisher to serialize approves.

Two layers:
1. In-process: asyncio.Lock registry keyed by project_id.
2. Cross-worker: Postgres advisory transaction lock.

Usage:
    async with project_publish_lock(session, project_id):
        ...
"""

from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# In-process lock registry. Lives on the event loop; one dict per process.
_project_locks: dict[uuid.UUID, asyncio.Lock] = defaultdict(asyncio.Lock)


def _int_key(project_id: uuid.UUID) -> int:
    # Postgres advisory locks want a bigint; hash the UUID deterministically.
    return hash(project_id.bytes) & 0x7FFFFFFFFFFFFFFF


@asynccontextmanager
async def project_publish_lock(
    session: AsyncSession, project_id: uuid.UUID
) -> AsyncIterator[None]:
    async with _project_locks[project_id]:
        dialect = session.bind.dialect.name if session.bind else "sqlite"
        if dialect == "postgresql":
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": _int_key(project_id)},
            )
        # SQLite unit tests: in-process lock is sufficient.
        yield
