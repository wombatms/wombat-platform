"""Integration tests for the ``top_failing_cases`` dashboard widget.

Tests call ``_query`` directly against a live Postgres session to avoid HTTP
overhead and to exercise the SQL GROUP BY / ORDER BY logic in isolation.

Seeding strategy
----------------
- One project with two environments.
- ``_seed_failures(n, wombat_id)`` creates N separate runs, each containing
  one run_case for the given snapshot.  This is necessary because the DB
  enforces a unique constraint ``ux_result_unique_case`` on
  ``(run_id, run_case_id)`` — only one result is allowed per case per run.
  The widget counts failures across *all* runs (GROUP BY snapshot_wombat_id),
  so multiple runs for the same snapshot accumulate the failure count.

All DB rows are rolled back at the end of each test function (``db_session``
is rolled back in conftest teardown).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Module-level skip guard (mirrors conftest.py pattern)
# ---------------------------------------------------------------------------
import os
import subprocess
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession


def _docker_or_env():
    """Return True if we can run integration tests."""
    if os.environ.get("WOMBAT_TEST_DATABASE_URL"):
        return True
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


if not _docker_or_env():
    pytest.skip(
        "Docker not available and WOMBAT_TEST_DATABASE_URL not set; "
        "skipping top_failing_cases widget integration tests.",
        allow_module_level=True,
    )

# ---------------------------------------------------------------------------
# Widget under test
# ---------------------------------------------------------------------------

from wombat_api.dashboards.registry import REGISTRY  # noqa: E402
from wombat_api.dashboards.widgets.top_failing_cases import META, _query  # noqa: E402

# ---------------------------------------------------------------------------
# Helper: deterministic UTC datetime
# ---------------------------------------------------------------------------

_NOW = datetime.now(tz=UTC)


def _dt(days_ago: float = 0) -> datetime:
    return _NOW - timedelta(days=days_ago)


# ---------------------------------------------------------------------------
# DB helper functions
# ---------------------------------------------------------------------------


async def _make_run(
    db_session: AsyncSession,
    project,
    user,
    env=None,
    closed_at: datetime | None = None,
) -> object:
    """Insert a run row and return it."""
    from wombat_api.database.models import RunDB

    run = RunDB(
        project_id=project.id,
        title=f"Run {uuid.uuid4().hex[:6]}",
        status="completed" if closed_at else "open",
        environment_id=env.id if env else None,
        source="manual",
        owner_id=user.id,
        closed_at=closed_at,
    )
    db_session.add(run)
    await db_session.flush()
    return run


async def _make_content(db_session: AsyncSession, project, wombat_id: str) -> object:
    """Insert a content row (testcase kind) and return it."""
    from wombat_api.database.models import Content

    row = Content(
        project_id=project.id,
        kind="testcase",
        wombat_id=wombat_id,
        title=f"Case {wombat_id}",
        tags=[],
        body={"kind": "testcase", "id": wombat_id},
        source_repo="test-repo",
        source_path=f"tests/{wombat_id}.md",
        source_revision="abc123",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:4]}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _make_snapshot(db_session: AsyncSession, content, wombat_id: str) -> object:
    """Insert a RunCaseSnapshot row (always fresh hash to avoid unique clash)."""
    from wombat_api.database.models import RunCaseSnapshotDB

    snap = RunCaseSnapshotDB(
        content_hash=f"snap-{uuid.uuid4().hex}",
        content_id=content.id,
        snapshot_body={"kind": "testcase", "id": wombat_id},
        snapshot_title=f"Case {wombat_id}",
        snapshot_wombat_id=wombat_id,
    )
    db_session.add(snap)
    await db_session.flush()
    return snap


async def _make_run_case(db_session: AsyncSession, run, snapshot, user, order: int = 0) -> object:
    """Insert a RunCase row and return it."""
    from wombat_api.database.models import RunCaseDB

    rc = RunCaseDB(
        run_id=run.id,
        snapshot_id=snapshot.id,
        display_order=order,
        added_by_user_id=user.id,
    )
    db_session.add(rc)
    await db_session.flush()
    return rc


async def _make_result(
    db_session: AsyncSession,
    run,
    run_case,
    user,
    status: str = "fail",
    updated_at: datetime | None = None,
) -> object:
    """Insert a Result row with the given status and updated_at.

    ``updated_at`` is patched via a direct UPDATE so we can set deterministic
    timestamps for time-window testing (the ORM column uses server_default).
    """
    from sqlalchemy import text

    from wombat_api.database.models import ResultDB

    res = ResultDB(
        run_id=run.id,
        run_case_id=run_case.id,
        status=status,
        source="manual",
        revision=1,
        recorded_by_user_id=user.id,
    )
    db_session.add(res)
    await db_session.flush()

    if updated_at is not None:
        await db_session.execute(
            text("UPDATE results SET updated_at = :ts WHERE id = :rid"),
            {"ts": updated_at, "rid": res.id},
        )
        await db_session.flush()

    return res


async def _seed_failures(
    db_session: AsyncSession,
    project,
    content,
    user,
    n: int,
    status: str = "fail",
    env=None,
    base_updated_at: datetime | None = None,
    days_ago_offset: float = 0,
) -> list:
    """Seed ``n`` failure results for one content/wombat_id.

    Because the unique constraint ``ux_result_unique_case(run_id, run_case_id)``
    allows only one result per case per run, each failure requires its own run.
    The widget's GROUP BY on ``snapshot_wombat_id`` correctly aggregates across
    all runs, so n=5 produces failures=5 for that wombat_id.

    Each result's ``updated_at`` is set to ``base_updated_at - i*minutes`` so
    the MAX(updated_at) is ``base_updated_at`` (most-recent failure = the first
    one inserted).  Pass ``base_updated_at=None`` to accept server timestamps.
    """
    results = []
    wombat_id = content.wombat_id
    for i in range(n):
        run = await _make_run(db_session, project, user, env=env, closed_at=_dt(days_ago_offset))
        snap = await _make_snapshot(db_session, content, wombat_id)
        rc = await _make_run_case(db_session, run, snap, user, order=0)
        ts = None
        if base_updated_at is not None:
            ts = base_updated_at - timedelta(minutes=i)
        result = await _make_result(db_session, run, rc, user, status=status, updated_at=ts)
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession):
    """Insert a single project and return the DB row."""
    from wombat_api.database.models import ProjectDB

    p = ProjectDB(
        slug=f"wfc-{uuid.uuid4().hex[:8]}",
        name="Widget Top Failing Test Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(p)
    await db_session.flush()
    return p


@pytest_asyncio.fixture
async def environments(db_session: AsyncSession, project):
    """Create two environments (staging, prod) and a seeder user."""
    from wombat_api.auth.passwords import hash_password
    from wombat_api.database.models import EnvironmentDB, UserDB

    user = UserDB(
        email=f"seeder-{uuid.uuid4().hex[:6]}@test.example",
        hashed_password=hash_password("Test1234!"),
        display_name="Seeder",
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    staging = EnvironmentDB(project_id=project.id, name="staging", created_by_user_id=user.id)
    prod = EnvironmentDB(project_id=project.id, name="prod", created_by_user_id=user.id)
    db_session.add_all([staging, prod])
    await db_session.flush()
    return {"staging": staging, "prod": prod, "user": user}


# ---------------------------------------------------------------------------
# Scope helpers
# ---------------------------------------------------------------------------


def _project_scope(project):
    return {"kind": "project", "project_id": str(project.id), "plan_wombat_id": None}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_widget_registered(db_session: AsyncSession):
    """Widget is in the registry after module import."""
    assert "top_failing_cases" in {m["slug"] for m in REGISTRY.list_meta()}
    assert META["slug"] == "top_failing_cases"
    assert "project" in META["scope_kinds"]
    assert "plan" in META["scope_kinds"]
    assert META["requires"] == []


async def test_basic_failures_returned(db_session: AsyncSession, project, environments):
    """Cases with fail results appear; pass-only cases are excluded."""
    user = environments["user"]

    # TC-A: 3 failures (3 separate runs, one result each)
    content_a = await _make_content(db_session, project, "TC-A")
    await _seed_failures(db_session, project, content_a, user, n=3)

    # TC-B: 1 pass-only result (should be excluded from the widget)
    content_b = await _make_content(db_session, project, "TC-B")
    run_b = await _make_run(db_session, project, user, closed_at=_dt(0))
    snap_b = await _make_snapshot(db_session, content_b, "TC-B")
    rc_b = await _make_run_case(db_session, run_b, snap_b, user, order=0)
    await _make_result(db_session, run_b, rc_b, user, status="pass")

    await db_session.commit()

    result = await _query(_project_scope(project), {}, db_session)
    wombat_ids = [c["wombat_id"] for c in result["cases"]]

    assert "TC-A" in wombat_ids, "TC-A (3 failures) must appear"
    assert "TC-B" not in wombat_ids, "TC-B (pass only) must be excluded"

    case_a = next(c for c in result["cases"] if c["wombat_id"] == "TC-A")
    assert case_a["failures"] == 3
    assert case_a["title"] == "Case TC-A"
    assert case_a["last_failed_at"] is not None


async def test_window_filter_narrows_results(db_session: AsyncSession, project, environments):
    """``window=7d`` excludes results older than 7 days; ``window=30d`` includes them."""
    user = environments["user"]

    # TC-RECENT: failure 2 days ago → inside both 7d and 30d windows.
    content_r = await _make_content(db_session, project, "TC-RECENT")
    await _seed_failures(db_session, project, content_r, user, n=1, base_updated_at=_dt(2))

    # TC-OLD: failure 20 days ago → inside 30d but outside 7d.
    content_o = await _make_content(db_session, project, "TC-OLD")
    await _seed_failures(db_session, project, content_o, user, n=1, base_updated_at=_dt(20))

    await db_session.commit()

    result_7d = await _query(_project_scope(project), {"window": "7d"}, db_session)
    result_30d = await _query(_project_scope(project), {"window": "30d"}, db_session)

    ids_7d = {c["wombat_id"] for c in result_7d["cases"]}
    ids_30d = {c["wombat_id"] for c in result_30d["cases"]}

    assert "TC-RECENT" in ids_7d, "Recent case should appear in 7d window"
    assert "TC-OLD" not in ids_7d, "Old case should not appear in 7d window"
    assert "TC-RECENT" in ids_30d, "Recent case should appear in 30d window"
    assert "TC-OLD" in ids_30d, "Old case should appear in 30d window"
    assert len(result_7d["cases"]) < len(result_30d["cases"]), "7d should return fewer cases"


async def test_top_10_cap(db_session: AsyncSession, project, environments):
    """At most 10 cases are returned even when more failing cases exist."""
    user = environments["user"]

    for i in range(14):
        wid = f"TC-CAP-{i:02d}"
        content = await _make_content(db_session, project, wid)
        await _seed_failures(
            db_session, project, content, user, n=1, base_updated_at=_dt(float(i))
        )

    await db_session.commit()

    result = await _query(_project_scope(project), {"window": "all"}, db_session)
    assert len(result["cases"]) == 10, "Should cap at 10 cases"


async def test_order_by_failures_desc(db_session: AsyncSession, project, environments):
    """Higher failure counts rank before lower ones."""
    user = environments["user"]

    # TC-HIGH: 5 failures
    content_h = await _make_content(db_session, project, "TC-HIGH")
    await _seed_failures(db_session, project, content_h, user, n=5)

    # TC-LOW: 2 failures
    content_l = await _make_content(db_session, project, "TC-LOW")
    await _seed_failures(db_session, project, content_l, user, n=2)

    await db_session.commit()

    result = await _query(_project_scope(project), {"window": "all"}, db_session)
    wombat_ids = [c["wombat_id"] for c in result["cases"]]

    assert "TC-HIGH" in wombat_ids and "TC-LOW" in wombat_ids
    assert wombat_ids.index("TC-HIGH") < wombat_ids.index("TC-LOW"), (
        "TC-HIGH (5 failures) must rank before TC-LOW (2 failures)"
    )


async def test_tied_counts_broken_by_last_failed_at_desc(db_session: AsyncSession, project, environments):
    """When failure counts tie, the case with the more recent failure ranks first."""
    user = environments["user"]

    # TC-NEWER: 2 failures, most recent = 1 day ago
    content_n = await _make_content(db_session, project, "TC-NEWER")
    await _seed_failures(db_session, project, content_n, user, n=2, base_updated_at=_dt(1))

    # TC-OLDER: 2 failures, most recent = 5 days ago
    content_o = await _make_content(db_session, project, "TC-OLDER")
    await _seed_failures(db_session, project, content_o, user, n=2, base_updated_at=_dt(5))

    await db_session.commit()

    result = await _query(_project_scope(project), {"window": "all"}, db_session)
    wombat_ids = [c["wombat_id"] for c in result["cases"]]

    assert "TC-NEWER" in wombat_ids and "TC-OLDER" in wombat_ids
    assert wombat_ids.index("TC-NEWER") < wombat_ids.index("TC-OLDER"), (
        "TC-NEWER (last failed 1d ago) must rank before TC-OLDER (last failed 5d ago) "
        "when failure counts are equal"
    )


async def test_tied_counts_and_same_last_failed_broken_by_wombat_id_asc(
    db_session: AsyncSession, project, environments
):
    """Final tiebreak (same count + same last_failed_at) uses wombat_id ASC (deterministic)."""
    user = environments["user"]
    same_ts = _dt(1)

    for wid in ("TC-ZZZ", "TC-AAA"):
        content = await _make_content(db_session, project, wid)
        await _seed_failures(db_session, project, content, user, n=1, base_updated_at=same_ts)

    await db_session.commit()

    # Run twice to confirm determinism.
    result1 = await _query(_project_scope(project), {"window": "all"}, db_session)
    result2 = await _query(_project_scope(project), {"window": "all"}, db_session)

    ids1 = [c["wombat_id"] for c in result1["cases"]]
    ids2 = [c["wombat_id"] for c in result2["cases"]]

    assert ids1 == ids2, "Results must be deterministic across calls"
    # TC-AAA < TC-ZZZ lexicographically → TC-AAA must rank first.
    assert ids1.index("TC-AAA") < ids1.index("TC-ZZZ"), (
        "TC-AAA must rank before TC-ZZZ when counts and timestamps are equal"
    )


async def test_zero_failures_excluded(db_session: AsyncSession, project, environments):
    """A case with only pass/blocked/skipped results must not appear."""
    user = environments["user"]

    for wid, status in [("TC-PASS-ONLY", "pass"), ("TC-BLOCKED", "blocked"), ("TC-SKIPPED", "skipped")]:
        content = await _make_content(db_session, project, wid)
        run = await _make_run(db_session, project, user, closed_at=_dt(0))
        snap = await _make_snapshot(db_session, content, wid)
        rc = await _make_run_case(db_session, run, snap, user, order=0)
        await _make_result(db_session, run, rc, user, status=status)

    await db_session.commit()

    result = await _query(_project_scope(project), {"window": "all"}, db_session)
    assert result["cases"] == [], "No failing cases → empty list"


async def test_env_filter_restricts_to_env(db_session: AsyncSession, project, environments):
    """``env_id`` filter restricts results to runs in that environment only."""
    user = environments["user"]
    staging = environments["staging"]
    prod = environments["prod"]

    # TC-STAGING: failure in staging run
    content_s = await _make_content(db_session, project, "TC-STAGING")
    run_staging = await _make_run(db_session, project, user, env=staging, closed_at=_dt(0))
    snap_s = await _make_snapshot(db_session, content_s, "TC-STAGING")
    rc_s = await _make_run_case(db_session, run_staging, snap_s, user, order=0)
    await _make_result(db_session, run_staging, rc_s, user, status="fail")

    # TC-PROD: failure in prod run
    content_p = await _make_content(db_session, project, "TC-PROD")
    run_prod = await _make_run(db_session, project, user, env=prod, closed_at=_dt(0))
    snap_p = await _make_snapshot(db_session, content_p, "TC-PROD")
    rc_p = await _make_run_case(db_session, run_prod, snap_p, user, order=0)
    await _make_result(db_session, run_prod, rc_p, user, status="fail")

    await db_session.commit()

    result_staging = await _query(
        _project_scope(project), {"window": "all", "env_id": str(staging.id)}, db_session
    )
    result_prod = await _query(
        _project_scope(project), {"window": "all", "env_id": str(prod.id)}, db_session
    )

    ids_staging = {c["wombat_id"] for c in result_staging["cases"]}
    ids_prod = {c["wombat_id"] for c in result_prod["cases"]}

    assert "TC-STAGING" in ids_staging
    assert "TC-PROD" not in ids_staging
    assert "TC-PROD" in ids_prod
    assert "TC-STAGING" not in ids_prod


async def test_project_isolation(db_session: AsyncSession, project, environments):
    """Failures in a different project must not bleed into the queried project."""
    from wombat_api.database.models import ProjectDB

    user = environments["user"]

    other_project = ProjectDB(
        slug=f"other-{uuid.uuid4().hex[:8]}",
        name="Other Project",
        org="test-org",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(other_project)
    await db_session.flush()

    # Failure in the target project — count = 1.
    content_mine = await _make_content(db_session, project, "TC-MINE")
    await _seed_failures(db_session, project, content_mine, user, n=1)

    # Failure in the other project — same wombat_id to stress isolation.
    content_other = await _make_content(db_session, other_project, "TC-MINE")
    await _seed_failures(db_session, other_project, content_other, user, n=1)

    await db_session.commit()

    result = await _query(_project_scope(project), {"window": "all"}, db_session)
    assert len(result["cases"]) == 1, "Only the target-project failure should appear"
    # The count must be 1 (not 2), since the other project's result is excluded.
    assert result["cases"][0]["failures"] == 1


async def test_response_shape(db_session: AsyncSession, project, environments):
    """Each case in the response has all four required keys."""
    user = environments["user"]

    content = await _make_content(db_session, project, "TC-SHAPE")
    await _seed_failures(db_session, project, content, user, n=1, base_updated_at=_dt(1))

    await db_session.commit()

    result = await _query(_project_scope(project), {}, db_session)
    assert len(result["cases"]) >= 1
    case = result["cases"][0]

    assert set(case.keys()) >= {"wombat_id", "title", "failures", "last_failed_at"}
    assert isinstance(case["failures"], int)
    assert case["failures"] >= 1
    assert isinstance(case["last_failed_at"], str)  # serialized ISO timestamp


async def test_window_all_includes_old_results(db_session: AsyncSession, project, environments):
    """``window=all`` includes results older than 90d."""
    user = environments["user"]

    content = await _make_content(db_session, project, "TC-ANCIENT")
    await _seed_failures(
        db_session, project, content, user, n=1,
        base_updated_at=_dt(100), days_ago_offset=100
    )

    await db_session.commit()

    result_90d = await _query(_project_scope(project), {"window": "90d"}, db_session)
    result_all = await _query(_project_scope(project), {"window": "all"}, db_session)

    ids_90d = {c["wombat_id"] for c in result_90d["cases"]}
    ids_all = {c["wombat_id"] for c in result_all["cases"]}

    assert "TC-ANCIENT" not in ids_90d, "100-day-old failure should not appear in 90d window"
    assert "TC-ANCIENT" in ids_all, "100-day-old failure should appear in 'all' window"
