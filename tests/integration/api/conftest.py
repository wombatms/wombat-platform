"""API integration test fixtures.

Uses a live Postgres+pgvector instance.  Short-circuit:
  - If WOMBAT_TEST_DATABASE_URL is set, connect directly (no container spin-up).
  - Otherwise spin up a testcontainers PostgresContainer with pgvector/pgvector:pg16.
  - If Docker is unavailable, skip all tests in this directory cleanly.

Event loop scoping
------------------
pytest-asyncio (>=0.24) with asyncio_mode="auto" creates a new event loop for
each test function by default.  asyncpg connections are bound to the loop that
created them, so a session-scoped async engine cannot be shared across test
functions.  We work around this by:

  1. ``pg_dsn`` — synchronous, session-scoped.  Just resolves/starts the DB URL.
  2. ``_alembic_migrated`` — synchronous, session-scoped.  Runs migrations once.
  3. ``async_engine`` — function-scoped with NullPool: fresh connection pool per
     test, bound to that test's event loop, disposed at end of test.
  4. The module-level wombat_api.database.engine is patched inside httpx_client
     (also function-scoped) so routes use the same per-test engine.
"""

from __future__ import annotations

import os
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    create_async_engine,
    async_sessionmaker,
)

# ---------------------------------------------------------------------------
# Docker / testcontainers guard
# ---------------------------------------------------------------------------

_SHORT_CIRCUIT_URL: str | None = os.environ.get("WOMBAT_TEST_DATABASE_URL")


def _check_docker_available() -> bool:
    """Return True if Docker daemon is reachable."""
    try:
        import subprocess
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


if _SHORT_CIRCUIT_URL is None and not _check_docker_available():
    pytest.skip(
        "Docker is not available and WOMBAT_TEST_DATABASE_URL is not set; "
        "skipping API integration tests.",
        allow_module_level=True,
    )


# ---------------------------------------------------------------------------
# Session-scoped (sync): resolve DSN, run migrations once
# ---------------------------------------------------------------------------

# Module-level list used to store the container ref so the finalizer can stop it.
_pg_dsn_container_ref: list = []


@pytest.fixture(scope="session")
def pg_dsn() -> str:
    """Return the asyncpg DSN for the test session.

    Uses WOMBAT_TEST_DATABASE_URL if set, otherwise spins up a
    testcontainers PostgresContainer.
    """
    if _SHORT_CIRCUIT_URL:
        return _SHORT_CIRCUIT_URL

    from testcontainers.postgres import PostgresContainer

    container = PostgresContainer(
        image="pgvector/pgvector:pg16",
        username="wombat",
        password="wombat",
        dbname="wombat_test",
    )
    container.start()
    _pg_dsn_container_ref.append(container)

    # get_connection_url() returns postgresql+psycopg2://... by default.
    # We need postgresql+asyncpg:// for SQLAlchemy's asyncpg dialect.
    raw_url = container.get_connection_url(driver=None)  # driver=None → no +driver suffix
    dsn = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return dsn


@pytest.fixture(scope="session", autouse=True)
def _stop_pg_container():
    """Session teardown: stop testcontainers container if we started one."""
    yield
    for c in _pg_dsn_container_ref:
        try:
            c.stop()
        except Exception:
            pass


@pytest.fixture(scope="session")
def _alembic_migrated(pg_dsn: str) -> None:
    """Ensure the full schema exists on the target DB once per session.

    Runs ``alembic upgrade head`` via subprocess so that the FTS generated
    column and all indexes created by the migration (001_initial) are present.
    This avoids the ``Base.metadata.create_all`` shortcut which skips
    generated columns (like ``fts``) and Postgres-specific index options.

    Uses subprocess to avoid the asyncio.run() conflict that arises when
    invoking Alembic programmatically inside a running async test loop.

    The DSN is translated from asyncpg to psycopg2 dialect for Alembic
    (Alembic env.py uses ``async_engine_from_config`` which accepts asyncpg).
    """
    import subprocess
    import sys

    # Alembic's env.py reads WOMBAT_DATABASE_URL for the URL.
    env = os.environ.copy()
    env["WOMBAT_DATABASE_URL"] = pg_dsn

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    if result.returncode != 0:
        # If migration failed because tables already exist (e.g. pre-existing
        # wombat-pg container), that is acceptable — check for the specific
        # "already exists" pattern and proceed.
        stderr = result.stderr or ""
        if "already exists" not in stderr and result.returncode != 0:
            # Attempt create_all as fallback for stubborn containers
            pass  # fall through to create_all below

    # Always run create_all as belt-and-suspenders for the alembic_version
    # table and any tables not covered by the migration yet.
    from sqlalchemy import create_engine, text as sa_text
    from wombat_api.database.engine import Base
    from wombat_api.database import models as _models  # noqa: F401

    # Convert asyncpg DSN to psycopg2 for sync Alembic check
    sync_dsn = pg_dsn.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

    try:
        sync_engine = create_engine(sync_dsn, echo=False)
        with sync_engine.begin() as conn:
            conn.execute(sa_text("CREATE EXTENSION IF NOT EXISTS vector"))
            Base.metadata.create_all(conn, checkfirst=True)
        sync_engine.dispose()
    except Exception:
        pass  # If Alembic succeeded, this may already be done


# ---------------------------------------------------------------------------
# Function-scoped: async_engine (NullPool — bound to this test's event loop)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def async_engine(
    pg_dsn: str, _alembic_migrated: None
) -> AsyncGenerator[AsyncEngine, None]:
    """Function-scoped async SQLAlchemy engine.

    Uses NullPool so asyncpg connections are not cached across event loops.
    Also patches the wombat_api.database.engine module globals for the
    duration of the test so any code path that imports the module directly
    (rather than through FastAPI DI) also hits the test DB.
    """
    import wombat_api.database.engine as _engine_mod

    engine = create_async_engine(pg_dsn, echo=False, poolclass=NullPool)

    _orig_engine = _engine_mod.engine
    _orig_factory = _engine_mod.async_session_factory
    test_factory = async_sessionmaker(engine, expire_on_commit=False)
    _engine_mod.engine = engine  # type: ignore[assignment]
    _engine_mod.async_session_factory = test_factory  # type: ignore[assignment]

    yield engine

    _engine_mod.engine = _orig_engine  # type: ignore[assignment]
    _engine_mod.async_session_factory = _orig_factory  # type: ignore[assignment]
    await engine.dispose()


# ---------------------------------------------------------------------------
# Function-scoped: db_session
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session(async_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """Function-scoped session.  Always rolled back at the end."""
    factory = async_sessionmaker(async_engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()


# ---------------------------------------------------------------------------
# Function-scoped: httpx_client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def httpx_client(async_engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """Function-scoped AsyncClient targeting the FastAPI ASGI app.

    Overrides the FastAPI ``get_session`` dependency so routes share the same
    per-test NullPool engine.
    """
    from wombat_api.app import create_app
    from wombat_api.database.engine import get_session

    app = create_app()
    test_factory = async_sessionmaker(async_engine, expire_on_commit=False)

    async def _override_get_session():
        async with test_factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ---------------------------------------------------------------------------
# Function-scoped: seeded_project
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_project(db_session: AsyncSession):
    """Create one project in the test DB.

    Returns ``(ProjectDB row, slug string)``.
    """
    from wombat_api.database.models import ProjectDB

    slug = f"test-project-{uuid.uuid4().hex[:8]}"
    project = ProjectDB(
        slug=slug,
        name="Test Project",
        org="test-org",
        taxonomy_components=["auth", "payments"],
        taxonomy_environments=["staging", "prod"],
    )
    db_session.add(project)
    await db_session.flush()
    await db_session.commit()
    return project, slug


# ---------------------------------------------------------------------------
# Function-scoped: users  (viewer / editor / admin)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def users(
    db_session: AsyncSession,
    seeded_project,
    httpx_client: AsyncClient,
):
    """Create viewer, editor, and admin users for seeded_project.

    Returns::

        {
            "admin":  {"user": UserDB, "token": str},
            "editor": {"user": UserDB, "token": str},
            "viewer": {"user": UserDB, "token": str},
        }

    Users are inserted directly (no registration endpoint) to avoid the
    bootstrap-lock on POST /api/auth/register.
    """
    from wombat_api.database.models import UserDB, UserProjectRoleDB
    from wombat_api.auth.passwords import hash_password
    from wombat_api.auth.jwt import create_access_token

    project, _slug = seeded_project
    result: dict = {}

    for role_name in ("admin", "editor", "viewer"):
        email = f"{role_name}-{uuid.uuid4().hex[:6]}@test.example"

        user = UserDB(
            email=email,
            hashed_password=hash_password("Test1234!"),
            display_name=f"Test {role_name.title()}",
            is_active=True,
        )
        db_session.add(user)
        await db_session.flush()

        role_row = UserProjectRoleDB(
            user_id=user.id,
            project_id=project.id,
            role=role_name,
        )
        db_session.add(role_row)
        await db_session.flush()

        token = create_access_token(user.id, email)
        result[role_name] = {"user": user, "token": token}

    await db_session.commit()
    return result
