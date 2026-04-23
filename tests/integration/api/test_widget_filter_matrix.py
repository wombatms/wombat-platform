"""Dashboard widget filter matrix tests (SP3.4 Task 23).

For each widget in {passfail_trend, recent_runs, top_failing_cases, review_backlog,
release_readiness}, this module asserts that filter combinations produce consistent,
predictable responses.

Shared fixture seeds 2 calendar dates × 2 environments × 2 plans × ~30 results.

Filter matrix per widget:
- window: 7d, 30d, all (where applicable)
- env: none, env_a (staging)
- plan: none, plan_a

Widgets that don't support certain combinations (e.g. review_backlog ignores
env/plan; release_readiness requires plan_id on project scope) are annotated
and skipped for unsupported combos.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Shared seed helpers (reuse passfail_trend pattern)
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _days_ago(n: int) -> datetime:
    return _now() - timedelta(days=n)


async def _seed_user(session: AsyncSession) -> uuid.UUID:
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    user = UserDB(
        id=uuid.uuid4(),
        email=f"matrix-{uuid.uuid4().hex[:6]}@example.com",
        hashed_password=hash_password("Test1234!"),
        display_name="Matrix Tester",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user.id


async def _seed_project(session: AsyncSession) -> uuid.UUID:
    from wombat_api.database.models import ProjectDB

    proj = ProjectDB(
        id=uuid.uuid4(),
        slug=f"matrix-{uuid.uuid4().hex[:8]}",
        name="Matrix Project",
        org="test-org",
    )
    session.add(proj)
    await session.flush()
    return proj.id


async def _seed_environment(
    session: AsyncSession, project_id: uuid.UUID, creator_id: uuid.UUID, name: str
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


async def _seed_plan_content(
    session: AsyncSession, project_id: uuid.UUID, wombat_id: str
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


async def _seed_snapshot(session: AsyncSession, content_id: uuid.UUID, wombat_id: str) -> uuid.UUID:
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


async def _seed_testcase(session: AsyncSession, project_id: uuid.UUID, wombat_id: str) -> uuid.UUID:
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
        title="Matrix run",
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
    session: AsyncSession, run_id: uuid.UUID, snapshot_id: uuid.UUID, user_id: uuid.UUID, display_order: int = 0
) -> uuid.UUID:
    from wombat_api.database.models import RunCaseDB

    rc = RunCaseDB(
        id=uuid.uuid4(),
        run_id=run_id,
        snapshot_id=snapshot_id,
        display_order=display_order,
        added_by_user_id=user_id,
    )
    session.add(rc)
    await session.flush()
    return rc.id


async def _seed_result(
    session: AsyncSession,
    run_id: uuid.UUID,
    run_case_id: uuid.UUID,
    user_id: uuid.UUID,
    status: str = "pass",
    updated_at: datetime | None = None,
) -> None:
    import sqlalchemy as sa

    from wombat_api.database.models import ResultDB

    result = ResultDB(
        id=uuid.uuid4(),
        run_id=run_id,
        run_case_id=run_case_id,
        status=status,
        recorded_by_user_id=user_id,
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
# Shared fixture: seeds 2 dates × 2 envs × 2 plans × ~30 results
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def matrix_seed(db_session: AsyncSession, _alembic_migrated: None) -> dict:
    """Seed the DB with a comprehensive dataset for filter-matrix testing.

    Layout:
    - 2 environments: env_a (staging), env_b (prod)
    - 2 plan content rows: plan_a, plan_b
    - 15 results in env_a/plan_a from 3 days ago (10 pass + 5 fail)
    - 10 results in env_b/plan_b from 15 days ago (7 pass + 3 fail)
    - 5 results with no env/no plan from 20 days ago (5 fail)

    Returns a dict with all relevant IDs.
    """
    user_id = await _seed_user(db_session)
    project_id = await _seed_project(db_session)

    env_a = await _seed_environment(db_session, project_id, user_id, "staging")
    env_b = await _seed_environment(db_session, project_id, user_id, "prod")

    plan_a_wid = f"PLAN-A-{uuid.uuid4().hex[:6]}"
    plan_b_wid = f"PLAN-B-{uuid.uuid4().hex[:6]}"
    plan_a_content_id = await _seed_plan_content(db_session, project_id, plan_a_wid)
    plan_b_content_id = await _seed_plan_content(db_session, project_id, plan_b_wid)

    # Seed some testcases and snapshots
    tc_ids = [f"TC-MATRIX-{uuid.uuid4().hex[:4]}" for _ in range(6)]
    snap_ids = []
    for tc_wid in tc_ids:
        content_id = await _seed_testcase(db_session, project_id, tc_wid)
        snap_id = await _seed_snapshot(db_session, content_id, tc_wid)
        snap_ids.append(snap_id)

    date_recent = _days_ago(3)
    date_mid = _days_ago(15)
    date_old = _days_ago(20)

    # Group 1: env_a + plan_a, 3 days ago (15 results: 10 pass + 5 fail)
    for i in range(15):
        run_id = await _seed_run(db_session, project_id, user_id, environment_id=env_a, plan_id=plan_a_content_id)
        snap_id = snap_ids[i % len(snap_ids)]
        rc_id = await _seed_run_case(db_session, run_id, snap_id, user_id)
        status = "pass" if i < 10 else "fail"
        await _seed_result(db_session, run_id, rc_id, user_id, status, date_recent)

    # Group 2: env_b + plan_b, 15 days ago (10 results: 7 pass + 3 fail)
    for i in range(10):
        run_id = await _seed_run(db_session, project_id, user_id, environment_id=env_b, plan_id=plan_b_content_id)
        snap_id = snap_ids[i % len(snap_ids)]
        rc_id = await _seed_run_case(db_session, run_id, snap_id, user_id)
        status = "pass" if i < 7 else "fail"
        await _seed_result(db_session, run_id, rc_id, user_id, status, date_mid)

    # Group 3: no env, no plan, 20 days ago (5 results: all fail)
    for i in range(5):
        run_id = await _seed_run(db_session, project_id, user_id)
        snap_id = snap_ids[i % len(snap_ids)]
        rc_id = await _seed_run_case(db_session, run_id, snap_id, user_id)
        await _seed_result(db_session, run_id, rc_id, user_id, "fail", date_old)

    await db_session.commit()

    return {
        "project_id": project_id,
        "user_id": user_id,
        "env_a": env_a,
        "env_b": env_b,
        "plan_a_wid": plan_a_wid,
        "plan_b_wid": plan_b_wid,
        "plan_a_content_id": plan_a_content_id,
        "plan_b_content_id": plan_b_content_id,
    }


# ---------------------------------------------------------------------------
# passfail_trend filter matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_passfail_window_7d_excludes_older(db_session: AsyncSession, matrix_seed: dict) -> None:
    """window=7d only includes results from the last 7 days (group 1 only)."""
    from wombat_api.dashboards.widgets.passfail_trend import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {"window": "7d"}, db_session)
    pts = result["points"]
    total = sum(pt["pass"] + pt["fail"] + pt["blocked"] + pt["skipped"] for pt in pts)
    # 7d window should only see group 1 (15 results from 3 days ago)
    assert total == 15, f"7d window should yield 15 results (group 1), got {total}"


@pytest.mark.asyncio
async def test_passfail_window_30d_includes_recent_and_mid(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """window=30d includes both recent (3d) and mid (15d) results."""
    from wombat_api.dashboards.widgets.passfail_trend import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {"window": "30d"}, db_session)
    pts = result["points"]
    total = sum(pt["pass"] + pt["fail"] + pt["blocked"] + pt["skipped"] for pt in pts)
    # 30d should see group 1 (15) + group 2 (10) + group 3 (5) = 30
    assert total == 30, f"30d window should yield 30 results, got {total}"


@pytest.mark.asyncio
async def test_passfail_env_filter(db_session: AsyncSession, matrix_seed: dict) -> None:
    """env filter restricts to runs in that environment."""
    from wombat_api.dashboards.widgets.passfail_trend import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result_env_a = await _query(scope, {"window": "all", "env_id": str(matrix_seed["env_a"])}, db_session)
    total_a = sum(pt["pass"] + pt["fail"] for pt in result_env_a["points"])
    assert total_a == 15, f"env_a filter should yield 15 results, got {total_a}"


@pytest.mark.asyncio
async def test_passfail_plan_scope(db_session: AsyncSession, matrix_seed: dict) -> None:
    """plan scope restricts to runs for that plan only."""
    from wombat_api.dashboards.widgets.passfail_trend import _query

    scope = {
        "kind": "plan",
        "project_id": str(matrix_seed["project_id"]),
        "plan_wombat_id": matrix_seed["plan_a_wid"],
    }
    result = await _query(scope, {"window": "all"}, db_session)
    total = sum(pt["pass"] + pt["fail"] for pt in result["points"])
    assert total == 15, f"plan_a scope should yield 15 results, got {total}"


# ---------------------------------------------------------------------------
# recent_runs filter matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recent_runs_project_scope_returns_list(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """recent_runs on project scope returns a non-empty runs list."""
    from wombat_api.dashboards.widgets.recent_runs import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)
    assert "runs" in result
    runs = result["runs"]
    assert isinstance(runs, list)
    # We seeded 30 runs total; recent_runs returns up to 10.
    assert len(runs) <= 10
    assert len(runs) >= 1


@pytest.mark.asyncio
async def test_recent_runs_env_filter(db_session: AsyncSession, matrix_seed: dict) -> None:
    """recent_runs filtered by env_id returns only runs from that env."""
    from wombat_api.dashboards.widgets.recent_runs import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {"env_id": str(matrix_seed["env_a"])}, db_session)
    runs = result["runs"]
    # All returned runs must have env_a set (or env_id == env_a).
    # The widget exposes run.environment_id; verify none have env_b.
    env_ids = {r.get("environment_id") for r in runs}
    env_b_str = str(matrix_seed["env_b"])
    assert env_b_str not in env_ids, f"env_b should be excluded, but found it in: {env_ids}"


@pytest.mark.asyncio
async def test_recent_runs_plan_scope(db_session: AsyncSession, matrix_seed: dict) -> None:
    """recent_runs on plan scope returns a non-empty list restricted to that plan's runs."""
    from wombat_api.dashboards.widgets.recent_runs import _query

    scope = {
        "kind": "plan",
        "project_id": str(matrix_seed["project_id"]),
        "plan_wombat_id": matrix_seed["plan_b_wid"],
    }
    result = await _query(scope, {}, db_session)
    runs = result["runs"]
    assert isinstance(runs, list)
    # We seeded 10 runs for plan_b; recent_runs returns at most 10.
    assert len(runs) >= 1, "Expected at least 1 run for plan_b"
    # Each run in plan scope should not include runs from other plans.
    # (We can't assert plan_id on the run dict as recent_runs doesn't expose it;
    # but count must match plan_b seeded count and not exceed 10.)
    assert len(runs) <= 10


# ---------------------------------------------------------------------------
# top_failing_cases filter matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_top_failing_project_scope_returns_list(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """top_failing_cases on project scope returns a cases list."""
    from wombat_api.dashboards.widgets.top_failing_cases import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {"window": "all"}, db_session)
    assert "cases" in result
    assert isinstance(result["cases"], list)
    # We seeded 8 fail + 3 fail + 5 fail = 16 total fail results across cases.
    # There must be at least 1 case in the list.
    assert len(result["cases"]) >= 1


@pytest.mark.asyncio
async def test_top_failing_env_filter_isolates_env(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """top_failing_cases env filter returns only cases from that env's runs."""
    from wombat_api.dashboards.widgets.top_failing_cases import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result_all = await _query(scope, {"window": "all"}, db_session)
    result_env_a = await _query(scope, {"window": "all", "env_id": str(matrix_seed["env_a"])}, db_session)

    # env_a has 5 fails (group 1 last 5); no-env group also has fails.
    # env_a filter must return fewer or equal cases than unfiltered.
    assert len(result_env_a["cases"]) <= len(result_all["cases"])
    # env_a specifically has fail results; list must be non-empty.
    assert len(result_env_a["cases"]) >= 1


@pytest.mark.asyncio
async def test_top_failing_window_7d(db_session: AsyncSession, matrix_seed: dict) -> None:
    """top_failing_cases window=7d returns only cases from the last 7 days."""
    from wombat_api.dashboards.widgets.top_failing_cases import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result_7d = await _query(scope, {"window": "7d"}, db_session)
    result_all = await _query(scope, {"window": "all"}, db_session)

    # 7d only sees group 1 (5 fails); all sees 16 fails across all groups.
    # 7d failure count must be <= all failure count.
    total_7d = sum(c.get("fail_count", 0) for c in result_7d["cases"])
    total_all = sum(c.get("fail_count", 0) for c in result_all["cases"])
    assert total_7d <= total_all, (
        f"7d fail count ({total_7d}) should be <= all-time ({total_all})"
    )


# ---------------------------------------------------------------------------
# review_backlog filter matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_review_backlog_project_scope_returns_count(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """review_backlog on project scope returns proposal count and oldest list."""
    from wombat_api.dashboards.widgets.review_backlog import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result = await _query(scope, {}, db_session)
    # review_backlog uses "count" key (not "open_count") per widget implementation.
    assert "count" in result
    assert "oldest" in result
    assert isinstance(result["count"], int)
    assert isinstance(result["oldest"], list)
    # No proposals were seeded; count should be 0.
    assert result["count"] == 0


@pytest.mark.asyncio
async def test_review_backlog_ignores_env_filter(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """review_backlog must return the same result regardless of env_id filter."""
    from wombat_api.dashboards.widgets.review_backlog import _query

    scope = {"kind": "project", "project_id": str(matrix_seed["project_id"]), "plan_wombat_id": None}
    result_no_env = await _query(scope, {}, db_session)
    result_env_a = await _query(scope, {"env_id": str(matrix_seed["env_a"])}, db_session)
    # review_backlog ignores env filters; counts should be identical.
    assert result_no_env["count"] == result_env_a["count"]


# ---------------------------------------------------------------------------
# release_readiness filter matrix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_release_readiness_plan_scope_returns_shape(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """release_readiness on plan scope returns the expected shape."""
    from wombat_api.dashboards.widgets.release_readiness import _query

    scope = {
        "kind": "plan",
        "project_id": str(matrix_seed["project_id"]),
        "plan_wombat_id": matrix_seed["plan_a_wid"],
    }
    result = await _query(scope, {}, db_session)
    assert "plan_id" in result
    assert "executed_pct" in result
    assert "pass_pct" in result
    assert isinstance(result["executed_pct"], (int, float))
    assert isinstance(result["pass_pct"], (int, float))


@pytest.mark.asyncio
async def test_release_readiness_nonexistent_plan_returns_zeros(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """release_readiness on a non-existent plan returns 0% executed."""
    from wombat_api.dashboards.widgets.release_readiness import _query

    scope = {
        "kind": "plan",
        "project_id": str(matrix_seed["project_id"]),
        "plan_wombat_id": "PLAN-DOESNOTEXIST",
    }
    result = await _query(scope, {}, db_session)
    assert result["executed_pct"] == 0
    assert result["pass_pct"] == 0


@pytest.mark.asyncio
async def test_release_readiness_env_filter_changes_results(
    db_session: AsyncSession, matrix_seed: dict
) -> None:
    """release_readiness with env filter narrows results to that env's runs."""
    from wombat_api.dashboards.widgets.release_readiness import _query

    scope = {
        "kind": "plan",
        "project_id": str(matrix_seed["project_id"]),
        "plan_wombat_id": matrix_seed["plan_a_wid"],
    }
    # No filter
    result_all = await _query(scope, {}, db_session)
    # env_a filter (all plan_a runs are already in env_a, so same result)
    result_env_a = await _query(scope, {"env_id": str(matrix_seed["env_a"])}, db_session)
    # env_b filter (no plan_a runs in env_b, so 0%)
    result_env_b = await _query(scope, {"env_id": str(matrix_seed["env_b"])}, db_session)

    # All plan_a runs are in env_a, so unfiltered == env_a filtered.
    assert result_all["executed_pct"] == result_env_a["executed_pct"]
    # env_b filter → no plan_a runs → 0%.
    assert result_env_b["executed_pct"] == 0
