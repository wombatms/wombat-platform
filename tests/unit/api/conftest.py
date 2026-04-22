"""Shared fixtures for unit-level repository / route tests.

Provides a SQLite in-memory async session and a seeded project + user for
tests that exercise the `Repository` class against SP3.3 schema objects.
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from wombat_api.database.engine import Base
from wombat_api.database.models import ProjectDB, UserDB


@pytest_asyncio.fixture
async def db_session():
    """Fresh SQLite in-memory async session (schema created via create_all)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest_asyncio.fixture
async def sample_user(db_session) -> UserDB:
    user = UserDB(
        id=uuid.uuid4(),
        email="runner@example.com",
        hashed_password="x",
        display_name="Runner",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def sample_project(db_session) -> ProjectDB:
    project = ProjectDB(
        id=uuid.uuid4(),
        slug="runs-proj",
        name="Runs Project",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(project)
    await db_session.flush()
    return project
