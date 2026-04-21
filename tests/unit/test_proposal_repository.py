"""Unit tests for repository proposal methods.

Covers:
- create_proposal (happy path, new-file + existing-content)
- open-proposal conflict detection (SQLite emulation of Postgres
  partial unique index)
- update_proposal_body optimistic-lock via base_revision
- transition_proposal_status + append_proposal_event + get_proposal_with_events
- list_proposals filtering + cursor pagination

Backend: SQLite in-memory (no Postgres required).  The partial unique
index `ux_proposal_open_per_content` is Postgres-only; the Python-side
SELECT in `Repository.create_proposal` is what these tests exercise.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from wombat_api.database.engine import Base
from wombat_api.database.models import ProjectDB, UserDB
from wombat_api.database.repository import (
    OpenProposalExistsError,
    ProposalFilters,
    ProposalNotOpenError,
    Repository,
    StaleBaseRevisionError,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def session():
    """Fresh SQLite in-memory async session (schema created via create_all)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest_asyncio.fixture
async def seeded(session) -> tuple[ProjectDB, UserDB]:
    project = ProjectDB(
        id=uuid.uuid4(),
        slug="p1",
        name="P1",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    user = UserDB(
        id=uuid.uuid4(),
        email="a@example.com",
        hashed_password="x",
        display_name="A",
    )
    session.add_all([project, user])
    await session.flush()
    return project, user


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_create_and_get_proposal(session, seeded):
    project, user = seeded
    repo = Repository(session)
    p = await repo.create_proposal(
        project_id=project.id,
        content_id=None,
        kind="testcase",
        source_path="tests/testcases/new.md",
        base_revision="deadbeef",
        proposed_title="New testcase",
        proposed_body={"frontmatter": {"id": "TC-NEW-0001"}, "markdown": "## Steps"},
        proposal_action="upsert",
        summary="Initial draft",
        author_user_id=user.id,
        author_kind="human",
    )
    assert p.status == "open"
    assert p.proposed_title == "New testcase"
    assert p.author_kind == "human"

    loaded = await repo.get_proposal(p.id)
    assert loaded is not None
    assert loaded.id == p.id
    assert loaded.proposed_title == "New testcase"
    assert loaded.proposed_body["markdown"] == "## Steps"


async def test_open_proposal_conflict(session, seeded):
    """A second OPEN proposal for the same content_id must raise."""
    project, user = seeded
    repo = Repository(session)
    content_id = uuid.uuid4()
    # Note: we bypass the content FK by using SQLite (no FK enforcement by
    # default) and focus on the proposal-level constraint.  The Postgres
    # migration adds `ux_proposal_open_per_content`; here we rely on the
    # Python-side SELECT in create_proposal.
    kwargs = dict(
        project_id=project.id,
        kind="testcase",
        source_path="tests/testcases/x.md",
        base_revision="abc",
        proposed_title="t",
        proposed_body={"frontmatter": {}, "markdown": ""},
        proposal_action="upsert",
        summary=None,
        author_user_id=user.id,
        author_kind="human",
    )
    first = await repo.create_proposal(content_id=content_id, **kwargs)
    with pytest.raises(OpenProposalExistsError) as excinfo:
        await repo.create_proposal(content_id=content_id, **kwargs)
    assert excinfo.value.existing_proposal_id == first.id

    # After transitioning the first to a non-open status, a new proposal is allowed.
    await repo.transition_proposal_status(first.id, new_status="withdrawn")
    second = await repo.create_proposal(content_id=content_id, **kwargs)
    assert second.id != first.id
    assert second.status == "open"


async def test_update_fails_on_stale_base_revision(session, seeded):
    project, user = seeded
    repo = Repository(session)
    p = await repo.create_proposal(
        project_id=project.id,
        content_id=None,
        kind="testcase",
        source_path="tests/testcases/x.md",
        base_revision="aaa",
        proposed_title="t",
        proposed_body={"frontmatter": {}, "markdown": ""},
        proposal_action="upsert",
        summary=None,
        author_user_id=user.id,
        author_kind="human",
    )
    with pytest.raises(StaleBaseRevisionError) as excinfo:
        await repo.update_proposal_body(
            p.id,
            proposed_title=None,
            proposed_body=None,
            summary=None,
            base_revision="bbb",
        )
    assert excinfo.value.current == "aaa"

    # With the correct base_revision it succeeds.
    updated = await repo.update_proposal_body(
        p.id,
        proposed_title="t2",
        proposed_body={"frontmatter": {}, "markdown": "updated"},
        summary="summary2",
        base_revision="aaa",
    )
    assert updated.proposed_title == "t2"
    assert updated.proposed_body["markdown"] == "updated"
    assert updated.summary == "summary2"

    # And a non-open proposal cannot be updated.
    await repo.transition_proposal_status(p.id, new_status="rejected")
    with pytest.raises(ProposalNotOpenError):
        await repo.update_proposal_body(
            p.id,
            proposed_title="t3",
            proposed_body=None,
            summary=None,
            base_revision="aaa",
        )


async def test_transition_and_event_log(session, seeded):
    project, user = seeded
    repo = Repository(session)
    p = await repo.create_proposal(
        project_id=project.id,
        content_id=None,
        kind="testcase",
        source_path="x.md",
        base_revision="a",
        proposed_title="t",
        proposed_body={"frontmatter": {}, "markdown": ""},
        proposal_action="upsert",
        summary=None,
        author_user_id=user.id,
        author_kind="human",
    )
    await repo.append_proposal_event(
        proposal_id=p.id, user_id=user.id, action="created"
    )
    await repo.append_proposal_event(
        proposal_id=p.id,
        user_id=user.id,
        action="approved",
        comment="LGTM",
        detail={"reviewer": "qa"},
    )
    updated = await repo.transition_proposal_status(
        p.id, new_status="published", published_sha="cafe"
    )
    assert updated.status == "published"
    assert updated.published_sha == "cafe"

    got = await repo.get_proposal_with_events(p.id)
    assert got is not None
    proposal, events = got
    assert proposal.id == p.id
    assert [e.action for e in events] == ["created", "approved"]
    assert events[1].comment == "LGTM"
    assert events[1].detail == {"reviewer": "qa"}


async def test_list_filters_and_pagination(session, seeded):
    project, user = seeded
    repo = Repository(session)

    async def _mk(**overrides):
        kwargs = dict(
            project_id=project.id,
            content_id=None,
            kind="testcase",
            source_path="x.md",
            base_revision="a",
            proposed_title="t",
            proposed_body={"frontmatter": {}, "markdown": ""},
            proposal_action="upsert",
            summary=None,
            author_user_id=user.id,
            author_kind="human",
        )
        kwargs.update(overrides)
        return await repo.create_proposal(**kwargs)

    # Create 5 proposals total with explicit, strictly monotonic created_at
    # values so cursor-based pagination over equal timestamps isn't ambiguous
    # (SQLite's server_default `now()` is second-resolution and ties otherwise).
    created_rows = []
    for i in range(3):
        row = await _mk(source_path=f"x{i}.md", proposed_title=f"t{i}")
        created_rows.append(row)
    shared = await _mk(
        kind="shared_step",
        source_path="ss.md",
        proposed_title="shared",
        author_kind="agent",
    )
    created_rows.append(shared)
    withdrawn = await _mk(source_path="gone.md", proposed_title="gone")
    created_rows.append(withdrawn)

    # Stagger created_at so ordering is deterministic; then flush.
    from datetime import datetime, timedelta

    base_dt = datetime(2026, 1, 1, 12, 0, 0)
    for i, row in enumerate(created_rows):
        row.created_at = base_dt + timedelta(seconds=i)
    await session.flush()

    await repo.transition_proposal_status(withdrawn.id, new_status="withdrawn")

    # Status=open default returns 4 rows (3 testcase + 1 shared_step).
    rows, cursor = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="open", limit=10),
    )
    assert len(rows) == 4
    assert cursor is None
    assert all(r.status == "open" for r in rows)

    # Kind filter narrows to testcase only.
    rows_tc, _ = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="open", kind="testcase", limit=10),
    )
    assert len(rows_tc) == 3
    assert all(r.kind == "testcase" for r in rows_tc)

    # Author kind filter picks up the shared_step (author_kind=agent).
    rows_agent, _ = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="open", author_kind="agent", limit=10),
    )
    assert len(rows_agent) == 1
    assert rows_agent[0].id == shared.id

    # Status=withdrawn returns exactly the one withdrawn proposal.
    rows_w, _ = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="withdrawn", limit=10),
    )
    assert len(rows_w) == 1
    assert rows_w[0].id == withdrawn.id

    # Pagination: limit=2 over 4 open proposals -> first page returns 2 + cursor.
    page1, cursor = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="open", limit=2),
    )
    assert len(page1) == 2
    assert cursor is not None

    # Next page picks up the remaining rows via the cursor and eventually stops.
    page2, cursor2 = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status="open", limit=2, cursor=cursor),
    )
    assert len(page2) == 2
    assert cursor2 is None
    seen_ids = {r.id for r in page1} | {r.id for r in page2}
    assert len(seen_ids) == 4

    # reset_project_proposals wipes everything for the project.
    await repo.reset_project_proposals(project.id)
    rows_after, _ = await repo.list_proposals(
        project_id=project.id,
        filters=ProposalFilters(status=None, limit=100),
    )
    assert rows_after == []
