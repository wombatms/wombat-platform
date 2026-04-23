"""Integration tests for the ``recent_runs`` dashboard widget (SP3.4 Task 13).

Tests call ``_query`` directly against a real Postgres session so we can seed
data at the DB level and verify exact SQL behaviour without the HTTP stack.

Coverage:
1. 10-run cap honored (seed 15 runs → response has exactly 10).
2. Env filter: only runs for the specified environment returned.
3. Plan filter via scope=plan: only runs whose ``plan_id`` matches the
   plan's content-row UUID.
4. ``pass_rate`` is ``None`` for a run with zero results and a clean float
   for a run with recorded results.
5. ``finished_at`` uses real ``closed_at`` column (mapped to wire name).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import WidgetFilters, WidgetScope
from wombat_api.dashboards.widgets.recent_runs import META, _query

# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


async def _seed_project(session: AsyncSession) -> uuid.UUID:
    """Insert a minimal ProjectDB row and return its UUID."""
    from wombat_api.database.models import ProjectDB

    project = ProjectDB(
        slug=f"rr-test-{uuid.uuid4().hex[:8]}",
        name="Recent Runs Test Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    session.add(project)
    await session.flush()
    return project.id


async def _seed_user(session: AsyncSession) -> uuid.UUID:
    """Insert a minimal UserDB row and return its UUID."""
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import UserDB

    email = f"rr-user-{uuid.uuid4().hex[:6]}@test.example"
    user = UserDB(
        email=email,
        hashed_password=hash_password("Test1234!"),
        display_name="RR Test User",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    return user.id


async def _seed_env(session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID) -> uuid.UUID:
    """Insert an EnvironmentDB row and return its UUID."""
    from wombat_api.database.models import EnvironmentDB

    env = EnvironmentDB(
        project_id=project_id,
        name=f"env-{uuid.uuid4().hex[:6]}",
        created_by_user_id=user_id,
    )
    session.add(env)
    await session.flush()
    return env.id


async def _seed_plan_content(
    session: AsyncSession, project_id: uuid.UUID, wombat_id: str
) -> uuid.UUID:
    """Insert a plan Content row and return its content UUID."""
    from wombat_api.database.models import Content

    row = Content(
        project_id=project_id,
        kind="plan",
        wombat_id=wombat_id,
        title=f"Plan {wombat_id}",
        tags=[],
        body={"kind": "plan", "title": f"Plan {wombat_id}"},
        source_repo="test-repo",
        source_path=f"plans/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-plan-{wombat_id}-{uuid.uuid4().hex[:4]}",
    )
    session.add(row)
    await session.flush()
    return row.id


async def _seed_run(
    session: AsyncSession,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    *,
    title: str = "Run",
    status: str = "completed",
    env_id: uuid.UUID | None = None,
    plan_id: uuid.UUID | None = None,
    closed_at: datetime | None = None,
) -> uuid.UUID:
    """Insert a RunDB row and return its UUID."""
    from wombat_api.database.models import RunDB

    run = RunDB(
        project_id=project_id,
        title=title,
        status=status,
        owner_id=owner_id,
        environment_id=env_id,
        plan_id=plan_id,
        closed_at=closed_at,
    )
    session.add(run)
    await session.flush()
    return run.id


async def _seed_result(
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    status: str = "pass",
    run_case_id: uuid.UUID | None = None,
    recorded_by_user_id: uuid.UUID | None = None,
) -> None:
    """Insert a result row for a run.  Creates a minimal RunCaseDB + snapshot if needed."""
    from wombat_api.database.models import Content, ResultDB, RunCaseDB, RunCaseSnapshotDB

    if run_case_id is None:
        # Seed a minimal Content + snapshot + run_case so FK constraints pass.
        # Look up project_id from run row to satisfy content FK.
        from sqlalchemy import text as sa_text

        r = await session.execute(sa_text("SELECT project_id, owner_id FROM runs WHERE id = :rid"), {"rid": str(run_id)})
        row = r.mappings().one()
        project_id = row["project_id"]
        if recorded_by_user_id is None:
            recorded_by_user_id = row["owner_id"]

        wid = f"TC-RR-{uuid.uuid4().hex[:8]}"
        content = Content(
            project_id=project_id,
            kind="testcase",
            wombat_id=wid,
            title=f"Test {wid}",
            tags=[],
            body={"frontmatter": {"kind": "testcase", "id": wid}, "markdown": "# Step\n\n1. Do it."},
            source_repo="test-repo",
            source_path=f"tests/{wid}.md",
            source_revision="abc123",
            content_hash=f"hash-{wid}-{uuid.uuid4().hex[:4]}",
        )
        session.add(content)
        await session.flush()

        ch = f"snapshot-hash-{uuid.uuid4().hex}"
        snapshot = RunCaseSnapshotDB(
            content_hash=ch,
            content_id=content.id,
            snapshot_body=content.body,
            snapshot_title=content.title,
            snapshot_wombat_id=wid,
        )
        session.add(snapshot)
        await session.flush()

        run_case = RunCaseDB(
            run_id=run_id,
            snapshot_id=snapshot.id,
            display_order=1,
            added_by_user_id=recorded_by_user_id,
        )
        session.add(run_case)
        await session.flush()
        run_case_id = run_case.id

    result = ResultDB(
        run_id=run_id,
        run_case_id=run_case_id,
        status=status,
        source="manual",
        recorded_by_user_id=recorded_by_user_id,
    )
    session.add(result)
    await session.flush()


def _scope(project_id: uuid.UUID, plan_wombat_id: str | None = None) -> WidgetScope:
    return {
        "kind": "plan" if plan_wombat_id else "project",
        "project_id": str(project_id),
        "plan_wombat_id": plan_wombat_id,
    }


def _filters(**kwargs) -> WidgetFilters:
    return {k: v for k, v in kwargs.items()}  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_meta_slug():
    """Widget metadata has the correct slug."""
    assert META["slug"] == "recent_runs"
    assert "project" in META["scope_kinds"]
    assert "plan" in META["scope_kinds"]
    assert META["requires"] == []


@pytest.mark.asyncio
async def test_10_run_cap(db_session: AsyncSession):
    """Seed 15 runs; the widget must return exactly 10."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)
    await db_session.flush()

    now = datetime.now(UTC)
    for i in range(15):
        # Use fixed closed_at so ordering is deterministic.
        from datetime import timedelta

        closed = now - timedelta(hours=i)
        await _seed_run(
            db_session,
            project_id,
            user_id,
            title=f"Run {i}",
            closed_at=closed,
        )

    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    runs = result["runs"]
    assert len(runs) == 10, f"Expected 10, got {len(runs)}"


@pytest.mark.asyncio
async def test_env_filter(db_session: AsyncSession):
    """Only runs with the specified environment_id are returned."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)
    env_id = await _seed_env(db_session, project_id, user_id)
    await db_session.flush()

    # 3 runs in target env, 4 runs with no env.
    for i in range(3):
        await _seed_run(db_session, project_id, user_id, title=f"Env run {i}", env_id=env_id)
    for i in range(4):
        await _seed_run(db_session, project_id, user_id, title=f"No-env run {i}")

    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all", env_id=str(env_id)), db_session)
    runs = result["runs"]
    assert len(runs) == 3, f"Expected 3 env-filtered runs, got {len(runs)}"
    for r in runs:
        assert r["environment"] is not None


@pytest.mark.asyncio
async def test_plan_scope_filter(db_session: AsyncSession):
    """Plan-scope query returns only runs whose plan_id matches the plan content row."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)

    plan_wid = f"PLAN-{uuid.uuid4().hex[:6]}"
    plan_content_id = await _seed_plan_content(db_session, project_id, plan_wid)
    other_plan_content_id = await _seed_plan_content(db_session, project_id, f"PLAN-OTHER-{uuid.uuid4().hex[:4]}")
    await db_session.flush()

    # 2 runs linked to target plan, 3 linked to other plan, 1 with no plan.
    for i in range(2):
        await _seed_run(db_session, project_id, user_id, title=f"Plan run {i}", plan_id=plan_content_id)
    for i in range(3):
        await _seed_run(db_session, project_id, user_id, title=f"Other plan run {i}", plan_id=other_plan_content_id)
    await _seed_run(db_session, project_id, user_id, title="No-plan run")

    await db_session.flush()

    scope = _scope(project_id, plan_wombat_id=plan_wid)
    result = await _query(scope, _filters(window="all"), db_session)
    runs = result["runs"]
    assert len(runs) == 2, f"Expected 2 plan-scoped runs, got {len(runs)}"


@pytest.mark.asyncio
async def test_pass_rate_null_for_zero_results(db_session: AsyncSession):
    """A run with no results must have pass_rate=None (not 0.0 or NaN)."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)

    await _seed_run(db_session, project_id, user_id, title="Zero-results run")
    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    runs = result["runs"]
    assert len(runs) >= 1
    zero_run = next(r for r in runs if r["title"] == "Zero-results run")
    assert zero_run["pass_rate"] is None, f"Expected None, got {zero_run['pass_rate']}"


@pytest.mark.asyncio
async def test_pass_rate_float_for_run_with_results(db_session: AsyncSession):
    """A run with 3 pass and 1 fail results must have pass_rate ≈ 0.75."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)

    run_id = await _seed_run(db_session, project_id, user_id, title="Rated run")
    await db_session.flush()

    # Seed 3 pass results and 1 fail result.
    for _ in range(3):
        await _seed_result(db_session, run_id, status="pass", recorded_by_user_id=user_id)
    await _seed_result(db_session, run_id, status="fail", recorded_by_user_id=user_id)
    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    runs = result["runs"]
    rated = next(r for r in runs if r["title"] == "Rated run")
    assert rated["pass_rate"] is not None
    assert abs(rated["pass_rate"] - 0.75) < 0.001, f"Expected 0.75, got {rated['pass_rate']}"


@pytest.mark.asyncio
async def test_finished_at_is_closed_at_column(db_session: AsyncSession):
    """The 'finished_at' wire field is populated from runs.closed_at."""

    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)

    closed = datetime(2026, 4, 22, 12, 0, 0, tzinfo=UTC)
    await _seed_run(db_session, project_id, user_id, title="Closed run", closed_at=closed)
    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    runs = result["runs"]
    closed_run = next(r for r in runs if r["title"] == "Closed run")
    assert closed_run["finished_at"] is not None
    # ISO string must contain the date component.
    assert "2026-04-22" in closed_run["finished_at"]


@pytest.mark.asyncio
async def test_open_run_has_null_finished_at(db_session: AsyncSession):
    """An open run (closed_at=NULL) must surface finished_at=None."""
    project_id = await _seed_project(db_session)
    user_id = await _seed_user(db_session)

    await _seed_run(
        db_session,
        project_id,
        user_id,
        title="Open run",
        status="open",
        closed_at=None,
    )
    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    runs = result["runs"]
    open_run = next(r for r in runs if r["title"] == "Open run")
    assert open_run["finished_at"] is None


@pytest.mark.asyncio
async def test_project_isolation(db_session: AsyncSession):
    """Runs from another project are not returned."""
    project_a = await _seed_project(db_session)
    project_b = await _seed_project(db_session)
    user_id = await _seed_user(db_session)
    await db_session.flush()

    await _seed_run(db_session, project_a, user_id, title="Project A run")
    await _seed_run(db_session, project_b, user_id, title="Project B run")
    await db_session.flush()

    result = await _query(_scope(project_a), _filters(window="all"), db_session)
    titles = [r["title"] for r in result["runs"]]
    assert "Project A run" in titles
    assert "Project B run" not in titles


@pytest.mark.asyncio
async def test_returns_dict_with_runs_key(db_session: AsyncSession):
    """The query always returns a dict with a 'runs' list, even when empty."""
    project_id = await _seed_project(db_session)
    await db_session.flush()

    result = await _query(_scope(project_id), _filters(window="all"), db_session)
    assert isinstance(result, dict)
    assert "runs" in result
    assert isinstance(result["runs"], list)
