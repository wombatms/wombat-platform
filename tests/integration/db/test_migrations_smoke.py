"""Smoke test: full alembic upgrade head on a clean database.

Asserts that the SP3.3 schema (and every prior revision) applies cleanly,
and that all 8 SP3.3 execution tables exist after ``alembic upgrade head``.

Docker / environment contract
-----------------------------
Same pattern as ``tests/integration/api/conftest.py``:

  - If ``WOMBAT_TEST_DATABASE_URL`` is set, use it directly (no container).
  - Otherwise spin up a testcontainers ``pgvector/pgvector:pg16`` container.
  - If Docker is unavailable and no URL is set, skip the whole module.

This test is intentionally light-weight (no pytest-asyncio, no full fixtures).
It runs ``alembic upgrade head`` via subprocess against a throw-away schema,
then inspects the table list.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid

import pytest

SP3_3_TABLES = {
    "environments",
    "runs",
    "run_assignees",
    "run_case_snapshots",
    "run_cases",
    "results",
    "result_evidence",
    "run_events",
}


def _docker_available() -> bool:
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


_SHORT_CIRCUIT_URL: str | None = os.environ.get("WOMBAT_TEST_DATABASE_URL")

if _SHORT_CIRCUIT_URL is None and not _docker_available():
    pytest.skip(
        "Docker is not available and WOMBAT_TEST_DATABASE_URL is not set; "
        "skipping migration smoke tests.",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def pg_dsn():
    """Yield an asyncpg DSN for the test session.

    Either the pre-seeded ``WOMBAT_TEST_DATABASE_URL`` or a new
    testcontainers pg16+pgvector.
    """
    if _SHORT_CIRCUIT_URL:
        yield _SHORT_CIRCUIT_URL
        return

    from testcontainers.postgres import PostgresContainer

    container = PostgresContainer(
        image="pgvector/pgvector:pg16",
        username="wombat",
        password="wombat",
        dbname="wombat_test_migrations",
    )
    container.start()
    try:
        raw = container.get_connection_url(driver=None)
        dsn = raw.replace("postgresql://", "postgresql+asyncpg://", 1)
        yield dsn
    finally:
        container.stop()


def _fresh_database(pg_dsn: str) -> str:
    """Create a throw-away Postgres database and return a DSN scoped to it.

    Running each smoke test in its own database avoids any interaction with
    tables / alembic_version rows that a prior integration-test run may have
    left in the shared container.
    """
    import asyncio
    from urllib.parse import urlparse, urlunparse

    import asyncpg

    raw_dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    new_db = f"smoke_{uuid.uuid4().hex[:12]}"

    async def _create() -> None:
        # asyncpg requires an existing DB to connect to; use the admin DB.
        conn = await asyncpg.connect(raw_dsn)
        try:
            await conn.execute(f'CREATE DATABASE "{new_db}"')
            # Install pgvector inside the new DB so migration 001 succeeds.
        finally:
            await conn.close()

    asyncio.run(_create())

    # Rewrite the DSN to point at the new DB name.
    parsed = urlparse(pg_dsn)
    new_dsn = urlunparse(parsed._replace(path=f"/{new_db}"))

    async def _install_vector() -> None:
        conn = await asyncpg.connect(
            new_dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
        )
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        finally:
            await conn.close()

    asyncio.run(_install_vector())
    return new_dsn


def test_alembic_upgrade_head_creates_all_sp3_3_tables(pg_dsn: str) -> None:
    """``alembic upgrade head`` applies cleanly and produces all 8 SP3.3 tables."""
    import asyncio

    from sqlalchemy import inspect
    from sqlalchemy.ext.asyncio import create_async_engine

    # Use a dedicated DB so we don't collide with other suites sharing
    # the same container via WOMBAT_TEST_DATABASE_URL.
    dsn = _fresh_database(pg_dsn)

    env = os.environ.copy()
    env["WOMBAT_DATABASE_URL"] = dsn
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
    )

    async def _inspect() -> set[str]:
        eng = create_async_engine(dsn)
        try:
            async with eng.connect() as c:
                tables = await c.run_sync(lambda s: inspect(s).get_table_names())
            return set(tables)
        finally:
            await eng.dispose()

    tables = asyncio.run(_inspect())

    missing = SP3_3_TABLES - tables
    assert not missing, f"Missing SP3.3 tables after upgrade head: {sorted(missing)}"

    # SP2 runs scaffolding must have been dropped by the SP3.3 migration.
    assert "execution_results" not in tables, (
        "SP2 execution_results table should have been dropped by SP3.3 migration"
    )
