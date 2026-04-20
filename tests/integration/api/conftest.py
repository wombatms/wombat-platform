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


@pytest_asyncio.fixture(scope="session")
async def _alembic_migrated(pg_dsn: str) -> None:
    """Ensure the schema exists on the target DB once per session.

    Uses ``Base.metadata.create_all`` with ``checkfirst=True`` — this is
    idempotent, works against any asyncpg-reachable Postgres, and avoids the
    fragility of running Alembic inside pytest (Alembic's env.py calls
    ``asyncio.run()`` which conflicts with the running test event loop and
    with module-level ``lru_cache`` interactions).

    For new testcontainers databases the tables won't exist yet; create_all
    creates them.  For the pre-existing wombat-pg container the tables already
    exist; create_all with checkfirst=True is a no-op.
    """
    from sqlalchemy import text
    from wombat_api.database.engine import Base
    from wombat_api.database import models as _models  # noqa: F401 — registers tables on Base

    engine = create_async_engine(pg_dsn, echo=False, poolclass=NullPool)
    async with engine.begin() as conn:
        # pgvector extension must exist before Vector columns can be created.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)
    await engine.dispose()


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
