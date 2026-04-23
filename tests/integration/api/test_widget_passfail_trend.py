"""Integration tests for the passfail_trend dashboard widget.

Strategy (option a from the task spec): call _query directly against a real
Postgres session from the testcontainers conftest.  The dashboards router
(Task 17) is not wired yet, so we skip the HTTP layer and test the query
function in isolation.

DB rows seeded per-test via db_session; all writes committed before the
query runs so they are visible to the same session.

Real column names used:
- ``results.updated_at``  — date-bucketing column (spec called it finished_at).
- ``runs.closed_at``      — used for time-window restriction on runs.
- ``runs.environment_id`` — optional env filter.
- ``runs.plan_id``        — optional plan filter (UUID → content.id).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.widgets.passfail_trend import META, _query

# ---------------------------------------------------------------------------
# Shared seed helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _days_ago(n: int) -> datetime:
    return _now() - timedelta(days=n)


async def _seed_user(session: AsyncSession) -> uuid.UUID:
    """Insert a minimal user row and return its id."""
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    user = UserDB(
        id=uuid.uuid4(),
        email=f"widget-test-{uuid.uuid4().hex[:6]}@example.com",
        hashed_password=hash_password("Test1234!"),
        display_name="Widget Tester",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user.id


async def _seed_project(session: AsyncSession) -> uuid.UUID:
    from wombat_api.database.models import ProjectDB

    project = ProjectDB(
        id=uuid.uuid4(),
        slug=f"widget-pf-{uuid.uuid4().hex[:8]}",
        name="Widget PF Project",
        org="test-org",
    )
    session.add(project)
    await session.flush()
    return project.id


async def _seed_environment(
    session: AsyncSession,
    project_id: uuid.UUID,
    creator_id: uuid.UUID,
    name: str = "staging",
) -> uuid.UUID:
    from wombat_api.database.models import EnvironmentDB

    env = EnvironmentDB(
        id=uuid.uuid4(),
        project_id=project_id,
        name=name,
        created_by_user_id=creator_id,
    )
    session.add(env)
    await session.flush()
    return env.id


async def _seed_content_plan(
    session: AsyncSession, project_id: uuid.UUID, wombat_id: str = "PLAN-001"
) -> uuid.UUID:
    from wombat_api.database.models import Content

    row = Content(
        id=uuid.uuid4(),
        project_id=project_id,
        kind="plan",
        wombat_id=wombat_id,
        title=f"Plan {wombat_id}",
        tags=[],
        body={},
        source_repo="test-repo",
        source_path=f"plans/{wombat_id}.yaml",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    session.add(row)
    await session.flush()
    return row.id


async def _seed_run(
    session: AsyncSession,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    environment_id: uuid.UUID | None = None,
    plan_id: uuid.UUID | None = None,
    closed_at: datetime | None = None,
) -> uuid.UUID:
    from wombat_api.database.models import RunDB

    run = RunDB(
        id=uuid.uuid4(),
        project_id=project_id,
        title="Test run",
        status="completed" if closed_at else "open",
        owner_id=owner_id,
        source="manual",
        environment_id=environment_id,
        plan_id=plan_id,
        closed_at=closed_at,
    )
    session.add(run)
    await session.flush()
    return run.id


async def _seed_run_case(
    session: AsyncSession,
    run_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    added_by: uuid.UUID,
    display_order: int = 0,
) -> uuid.UUID:
    from wombat_api.database.models import RunCaseDB

    rc = RunCaseDB(
        id=uuid.uuid4(),
        run_id=run_id,
        snapshot_id=snapshot_id,
        display_order=display_order,
        added_by_user_id=added_by,
    )
    session.add(rc)
    await session.flush()
    return rc.id


async def _seed_snapshot(
    session: AsyncSession,
    content_id: uuid.UUID,
    wombat_id: str,
) -> uuid.UUID:
    from wombat_api.database.models import RunCaseSnapshotDB

    snap = RunCaseSnapshotDB(
        id=uuid.uuid4(),
        content_hash=f"snap-{uuid.uuid4().hex}",
        content_id=content_id,
        snapshot_body={"frontmatter": {"id": wombat_id}, "markdown": "## Steps\n\n1. Step."},
        snapshot_title=f"Test {wombat_id}",
        snapshot_wombat_id=wombat_id,
    )
    session.add(snap)
    await session.flush()
    return snap.id


async def _seed_content_case(
    session: AsyncSession, project_id: uuid.UUID, wombat_id: str
) -> uuid.UUID:
    from wombat_api.database.models import Content

    row = Content(
        id=uuid.uuid4(),
        project_id=project_id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Test {wombat_id}",
        tags=[],
        body={"frontmatter": {"kind": "testcase", "id": wombat_id}, "markdown": "## Steps\n\n1. Step."},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    session.add(row)
    await session.flush()
    return row.id


async def _seed_result(
    session: AsyncSession,
    run_id: uuid.UUID,
    run_case_id: uuid.UUID,
    recorder_id: uuid.UUID,
    status: str = "pass",
    updated_at: datetime | None = None,
) -> None:
    """Seed a result row.  updated_at is set via a raw UPDATE after INSERT
    because SQLAlchemy sets server_default but we need to control the timestamp
    for time-bucketing assertions.
    """
    import sqlalchemy as sa

    from wombat_api.database.models import ResultDB

    result = ResultDB(
        id=uuid.uuid4(),
        run_id=run_id,
        run_case_id=run_case_id,
        status=status,
        recorded_by_user_id=recorder_id,
        source="manual",
        revision=1,
    )
    session.add(result)
    await session.flush()

    if updated_at is not None:
        await session.execute(
            sa.text("UPDATE results SET updated_at = :ts WHERE id = :rid"),
            {"ts": updated_at, "rid": result.id},
        )


# ---------------------------------------------------------------------------
# Test: buckets by day — two different dates produce at least 2 points
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passfail_trend_buckets_by_day(
    db_session: AsyncSession,
    _alembic_migrated: None,
):
    """Results on two distinct calendar days produce at least 2 distinct points.

    Checks that each point has the required keys: date, pass, fail, blocked, skipped.
    """
    user_id = await _seed_user(db_session)
    project_id = await _seed_project(db_session)
    content_id = await _seed_content_case(db_session, project_id, f"TC-BUCKET-{uuid.uuid4().hex[:4]}")
    snap_id = await _seed_snapshot(db_session, content_id, "TC-BUCKET-001")

    # Run 1 — result 5 days ago
    run1 = await _seed_run(db_session, project_id, user_id)
    rc1 = await _seed_run_case(db_session, run1, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run1, rc1, user_id, "pass", _days_ago(5))

    # Run 2 — result 1 day ago (different day)
    run2 = await _seed_run(db_session, project_id, user_id)
    rc2 = await _seed_run_case(db_session, run2, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run2, rc2, user_id, "fail", _days_ago(1))

    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_id), "plan_wombat_id": None}
    filters = {"window": "30d"}

    result = await _query(scope, filters, db_session)

    assert "points" in result
    pts = result["points"]
    assert len(pts) >= 2, f"Expected >= 2 points, got {len(pts)}: {pts}"

    required_keys = {"date", "pass", "fail", "blocked", "skipped"}
    for pt in pts:
        assert required_keys.issubset(pt.keys()), f"Point missing keys: {pt}"
        assert isinstance(pt["pass"], int)
        assert isinstance(pt["fail"], int)
        assert isinstance(pt["blocked"], int)
        assert isinstance(pt["skipped"], int)

    # Confirm pass and fail are captured somewhere across the points.
    total_pass = sum(pt["pass"] for pt in pts)
    total_fail = sum(pt["fail"] for pt in pts)
    assert total_pass >= 1, "Expected at least one pass result"
    assert total_fail >= 1, "Expected at least one fail result"


# ---------------------------------------------------------------------------
# Test: env filter narrows counts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passfail_trend_filtered_by_env(
    db_session: AsyncSession,
    _alembic_migrated: None,
):
    """Filtering to one env excludes results from runs in the other env."""
    user_id = await _seed_user(db_session)
    project_id = await _seed_project(db_session)

    env_a = await _seed_environment(db_session, project_id, user_id, "staging")
    env_b = await _seed_environment(db_session, project_id, user_id, "prod")

    content_id = await _seed_content_case(db_session, project_id, f"TC-ENV-{uuid.uuid4().hex[:4]}")
    snap_id = await _seed_snapshot(db_session, content_id, "TC-ENV-001")

    ts = _days_ago(2)

    # Run in env_a → pass result
    run_a = await _seed_run(db_session, project_id, user_id, environment_id=env_a)
    rc_a = await _seed_run_case(db_session, run_a, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_a, rc_a, user_id, "pass", ts)

    # Run in env_b → fail result
    run_b = await _seed_run(db_session, project_id, user_id, environment_id=env_b)
    rc_b = await _seed_run_case(db_session, run_b, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_b, rc_b, user_id, "fail", ts)

    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_id), "plan_wombat_id": None}

    # Unfiltered: should see both
    result_all = await _query(scope, {"window": "30d"}, db_session)
    total_pass_all = sum(pt["pass"] for pt in result_all["points"])
    total_fail_all = sum(pt["fail"] for pt in result_all["points"])
    assert total_pass_all >= 1
    assert total_fail_all >= 1

    # Filtered to env_a: only pass, no fail
    result_a = await _query(scope, {"window": "30d", "env_id": str(env_a)}, db_session)
    total_pass_a = sum(pt["pass"] for pt in result_a["points"])
    total_fail_a = sum(pt["fail"] for pt in result_a["points"])
    assert total_pass_a >= 1
    assert total_fail_a == 0, f"Expected 0 fails for env_a only, got {total_fail_a}"

    # Filtered to env_b: only fail, no pass
    result_b = await _query(scope, {"window": "30d", "env_id": str(env_b)}, db_session)
    total_pass_b = sum(pt["pass"] for pt in result_b["points"])
    total_fail_b = sum(pt["fail"] for pt in result_b["points"])
    assert total_pass_b == 0, f"Expected 0 passes for env_b only, got {total_pass_b}"
    assert total_fail_b >= 1


# ---------------------------------------------------------------------------
# Test: plan scope restricts to that plan's runs only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passfail_trend_plan_scope(
    db_session: AsyncSession,
    _alembic_migrated: None,
):
    """Plan-scoped query only returns results from runs associated with that plan."""
    user_id = await _seed_user(db_session)
    project_id = await _seed_project(db_session)

    plan_wid = f"PLAN-{uuid.uuid4().hex[:6]}"
    plan_content_id = await _seed_content_plan(db_session, project_id, plan_wid)

    content_id = await _seed_content_case(db_session, project_id, f"TC-PLAN-{uuid.uuid4().hex[:4]}")
    snap_id = await _seed_snapshot(db_session, content_id, "TC-PLAN-001")

    ts = _days_ago(3)

    # Run for the plan → pass result
    run_plan = await _seed_run(db_session, project_id, user_id, plan_id=plan_content_id)
    rc_plan = await _seed_run_case(db_session, run_plan, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_plan, rc_plan, user_id, "pass", ts)

    # Run NOT for the plan → fail result (should be excluded in plan scope)
    run_other = await _seed_run(db_session, project_id, user_id, plan_id=None)
    rc_other = await _seed_run_case(db_session, run_other, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_other, rc_other, user_id, "fail", ts)

    await db_session.commit()

    scope = {"kind": "plan", "project_id": str(project_id), "plan_wombat_id": plan_wid}
    result = await _query(scope, {"window": "30d"}, db_session)

    total_pass = sum(pt["pass"] for pt in result["points"])
    total_fail = sum(pt["fail"] for pt in result["points"])

    assert total_pass >= 1, "Expected at least one pass result for the plan"
    assert total_fail == 0, (
        f"Plan scope should exclude runs not in the plan, but got {total_fail} fails"
    )


# ---------------------------------------------------------------------------
# Test: window=7d excludes older-than-7d rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passfail_trend_window_7d_excludes_old(
    db_session: AsyncSession,
    _alembic_migrated: None,
):
    """Results older than 7 days are excluded when window=7d."""
    user_id = await _seed_user(db_session)
    project_id = await _seed_project(db_session)
    content_id = await _seed_content_case(db_session, project_id, f"TC-WIN-{uuid.uuid4().hex[:4]}")
    snap_id = await _seed_snapshot(db_session, content_id, "TC-WIN-001")

    # Old result: 20 days ago
    run_old = await _seed_run(db_session, project_id, user_id)
    rc_old = await _seed_run_case(db_session, run_old, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_old, rc_old, user_id, "fail", _days_ago(20))

    # Recent result: 2 days ago
    run_new = await _seed_run(db_session, project_id, user_id)
    rc_new = await _seed_run_case(db_session, run_new, snap_id, user_id, display_order=0)
    await _seed_result(db_session, run_new, rc_new, user_id, "pass", _days_ago(2))

    await db_session.commit()

    scope = {"kind": "project", "project_id": str(project_id), "plan_wombat_id": None}

    # 7d window: only recent result visible
    result_7d = await _query(scope, {"window": "7d"}, db_session)
    fail_7d = sum(pt["fail"] for pt in result_7d["points"])
    pass_7d = sum(pt["pass"] for pt in result_7d["points"])
    assert pass_7d >= 1, "Recent pass result should be in 7d window"
    assert fail_7d == 0, f"Old fail result should not appear in 7d window, got {fail_7d}"

    # 30d window: both visible
    result_30d = await _query(scope, {"window": "30d"}, db_session)
    fail_30d = sum(pt["fail"] for pt in result_30d["points"])
    pass_30d = sum(pt["pass"] for pt in result_30d["points"])
    assert pass_30d >= 1
    assert fail_30d >= 1, "Old fail result should appear in 30d window"


# ---------------------------------------------------------------------------
# Test: META slug and scope_kinds are correct
# ---------------------------------------------------------------------------


def test_widget_meta_shape():
    """META has the correct slug, title, scope_kinds, and requires."""
    assert META["slug"] == "passfail_trend"
    assert META["title"] == "Pass / fail trend"
    assert META["scope_kinds"] == {"project", "plan"}
    assert META["requires"] == []


# ---------------------------------------------------------------------------
# Test: REGISTRY includes this widget after import
# ---------------------------------------------------------------------------


def test_widget_registered_in_registry():
    """Importing the dashboards package registers passfail_trend in REGISTRY."""
    import wombat_api.dashboards  # noqa: F401 — ensure side-effect runs
    from wombat_api.dashboards.registry import REGISTRY

    slugs = [m["slug"] for m in REGISTRY.list_meta()]
    assert "passfail_trend" in slugs
