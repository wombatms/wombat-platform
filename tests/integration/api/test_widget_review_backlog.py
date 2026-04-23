"""Integration tests for the review_backlog dashboard widget.

Calls ``_query`` directly against a live Postgres session provisioned by
testcontainers (via the shared ``db_session`` fixture from conftest.py).

Scenarios:
- Only open proposals are counted; approved (published) + rejected proposals
  are excluded.
- age_days is computed in whole days from created_at.
- oldest-5 cap: with 7 open proposals the response has count=7 but only 5
  rows in oldest.
- Project isolation: open proposals in project B never surface in project A's
  widget result.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY
from wombat_api.dashboards.widgets.review_backlog import META, _query
from wombat_api.database.models import ProjectDB, ProposalDB, UserDB

# ---------------------------------------------------------------------------
# Helper: create a minimal project
# ---------------------------------------------------------------------------


async def _make_project(session: AsyncSession) -> ProjectDB:
    slug = f"wid-rbl-{uuid.uuid4().hex[:8]}"
    p = ProjectDB(
        slug=slug,
        name="Widget RBL Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    session.add(p)
    await session.flush()
    return p


# ---------------------------------------------------------------------------
# Helper: create a minimal user (needed for author_user_id FK)
# ---------------------------------------------------------------------------


async def _make_user(session: AsyncSession) -> UserDB:
    u = UserDB(
        email=f"rbl-user-{uuid.uuid4().hex[:8]}@test.example",
        hashed_password="$2b$12$fakehash",
        display_name="RBL Test User",
        is_active=True,
    )
    session.add(u)
    await session.flush()
    return u


# ---------------------------------------------------------------------------
# Helper: insert a proposal with an explicit status and created_at
# ---------------------------------------------------------------------------


async def _make_proposal(
    session: AsyncSession,
    project: ProjectDB,
    author: UserDB,
    *,
    status: str = "open",
    kind: str = "testcase",
    title: str = "Proposal title",
    created_at: datetime | None = None,
) -> ProposalDB:
    p = ProposalDB(
        project_id=project.id,
        kind=kind,
        source_path=f"tests/{uuid.uuid4().hex}.md",
        base_revision="abc123",
        proposed_title=title,
        proposed_body={"frontmatter": {"kind": kind}, "markdown": "## Steps\n\n1. Step."},
        proposal_action="upsert",
        author_user_id=author.id,
        author_kind="human",
        status=status,
    )
    session.add(p)
    await session.flush()

    # Override created_at if requested (needed for deterministic age_days tests).
    if created_at is not None:
        await session.execute(
            text("UPDATE proposals SET created_at = :ts WHERE id = :pid"),
            {"ts": created_at, "pid": str(p.id)},
        )
        await session.flush()

    return p


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project_a(db_session: AsyncSession) -> ProjectDB:
    p = await _make_project(db_session)
    await db_session.commit()
    return p


@pytest_asyncio.fixture
async def project_b(db_session: AsyncSession) -> ProjectDB:
    p = await _make_project(db_session)
    await db_session.commit()
    return p


@pytest_asyncio.fixture
async def author(db_session: AsyncSession) -> UserDB:
    u = await _make_user(db_session)
    await db_session.commit()
    return u


# ---------------------------------------------------------------------------
# Test: approved + rejected proposals are excluded from count + oldest
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approved_and_rejected_excluded(
    db_session: AsyncSession,
    project_a: ProjectDB,
    author: UserDB,
) -> None:
    """published + rejected proposals must not appear in count or oldest list."""
    # One open proposal.
    await _make_proposal(db_session, project_a, author, status="open", title="Open one")
    # One published (approved) proposal — should be excluded.
    await _make_proposal(db_session, project_a, author, status="published", title="Approved one")
    # One rejected proposal — should be excluded.
    await _make_proposal(db_session, project_a, author, status="rejected", title="Rejected one")
    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)

    assert result["count"] == 1, f"Expected 1 open proposal, got {result['count']}"
    assert len(result["oldest"]) == 1
    assert result["oldest"][0]["title"] == "Open one"


# ---------------------------------------------------------------------------
# Test: age_days computed in whole days
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_age_days_three_days(
    db_session: AsyncSession,
    project_a: ProjectDB,
    author: UserDB,
) -> None:
    """Proposal created 3 days ago must have age_days == 3."""
    three_days_ago = datetime.now(tz=UTC) - timedelta(days=3)
    await _make_proposal(
        db_session,
        project_a,
        author,
        status="open",
        title="Old proposal",
        created_at=three_days_ago,
    )
    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)

    assert result["count"] == 1
    assert len(result["oldest"]) == 1
    assert result["oldest"][0]["age_days"] == 3


# ---------------------------------------------------------------------------
# Test: oldest-5 cap when more than 5 open proposals exist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oldest_five_cap(
    db_session: AsyncSession,
    project_a: ProjectDB,
    author: UserDB,
) -> None:
    """With 7 open proposals: count=7 but oldest list has exactly 5 entries."""
    base_time = datetime.now(tz=UTC) - timedelta(days=10)
    for i in range(7):
        await _make_proposal(
            db_session,
            project_a,
            author,
            status="open",
            title=f"Proposal {i}",
            created_at=base_time + timedelta(hours=i),
        )
    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)

    assert result["count"] == 7, f"Expected count=7, got {result['count']}"
    assert len(result["oldest"]) == 5, f"Expected 5 oldest, got {len(result['oldest'])}"

    # Verify ordering: oldest first (earliest created_at first).
    ages = [row["age_days"] for row in result["oldest"]]
    # All should be ≥ those that came after; the list should be non-increasing
    # in age (oldest first = largest age_days first).
    assert ages == sorted(ages, reverse=True) or all(a == ages[0] for a in ages), (
        f"oldest list is not sorted oldest-first: {ages}"
    )


# ---------------------------------------------------------------------------
# Test: project isolation — proposals in project B don't surface in project A
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_isolation(
    db_session: AsyncSession,
    project_a: ProjectDB,
    project_b: ProjectDB,
    author: UserDB,
) -> None:
    """Open proposals in project B must not appear in project A's widget result."""
    # Proposal for project A.
    await _make_proposal(db_session, project_a, author, status="open", title="A proposal")
    # Open proposals for project B (3 of them).
    for i in range(3):
        await _make_proposal(db_session, project_b, author, status="open", title=f"B proposal {i}")
    await db_session.commit()

    scope_a = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result_a = await _query(scope_a, {}, db_session)

    assert result_a["count"] == 1, (
        f"Project A should only see its own proposals; got count={result_a['count']}"
    )
    ids_in_oldest = {row["id"] for row in result_a["oldest"]}
    # Verify no cross-project IDs.
    scope_b = {"kind": "project", "project_id": str(project_b.id), "plan_wombat_id": None}
    result_b = await _query(scope_b, {}, db_session)
    b_ids = {row["id"] for row in result_b["oldest"]}
    assert ids_in_oldest.isdisjoint(b_ids), "Project A oldest list contains project B proposal IDs"

    # Project B count is separate.
    assert result_b["count"] == 3


# ---------------------------------------------------------------------------
# Test: response shape contains required fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_response_shape(
    db_session: AsyncSession,
    project_a: ProjectDB,
    author: UserDB,
) -> None:
    """Each oldest entry must have id, kind, title, age_days."""
    await _make_proposal(
        db_session, project_a, author, status="open", kind="plan", title="My plan proposal"
    )
    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)

    assert "count" in result
    assert "oldest" in result
    assert result["count"] >= 1
    entry = result["oldest"][0]
    assert "id" in entry
    assert "kind" in entry
    assert "title" in entry
    assert "age_days" in entry
    assert entry["kind"] == "plan"
    assert entry["title"] == "My plan proposal"


# ---------------------------------------------------------------------------
# Test: empty project returns count=0 and empty oldest list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_project(
    db_session: AsyncSession,
    project_a: ProjectDB,
) -> None:
    """Project with no proposals returns count=0 and oldest=[]."""
    scope = {"kind": "project", "project_id": str(project_a.id), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)

    assert result["count"] == 0
    assert result["oldest"] == []


# ---------------------------------------------------------------------------
# Test: widget is registered in REGISTRY
# ---------------------------------------------------------------------------


def test_registry_contains_review_backlog() -> None:
    """REGISTRY.list_meta() must include the review_backlog slug after import."""
    slugs = [m["slug"] for m in REGISTRY.list_meta()]
    assert "review_backlog" in slugs


def test_meta_shape() -> None:
    """META must declare project-only scope with no required filters."""
    assert META["slug"] == "review_backlog"
    assert META["title"] == "Review backlog"
    assert META["scope_kinds"] == {"project"}
    assert META["requires"] == []
