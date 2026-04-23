"""Integration tests for the release_readiness dashboard widget.

Tests call ``_query`` directly against a live Postgres session (testcontainers)
seeded with content + run + results rows.  No HTTP layer involved here; the
route-level tests (test_dashboards_routes.py) cover HTTP dispatch.

Test coverage:
- Zero runs → executed_pct == 0.0, all cases in not_run
- Blockers list bounded to 25 even when > 25 blocking cases exist
- Latest-result wins: earlier fail + later pass → counted as pass
- Missing plan → empty response (not 404)
- Project scope without plan_id → HTTPException 400 (belt-and-suspenders guard)
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetScope
from wombat_api.dashboards.widgets.release_readiness import META, _query

# ---------------------------------------------------------------------------
# Helpers for seeding DB rows directly
# ---------------------------------------------------------------------------


async def _make_project(session: AsyncSession) -> uuid.UUID:
    """Insert a minimal project row; return its UUID."""
    pid = uuid.uuid4()
    await session.execute(
        sa.text(
            """
            INSERT INTO projects (id, slug, name, org, taxonomy_components, taxonomy_environments)
            VALUES (:id, :slug, :name, :org, '[]'::jsonb, '[]'::jsonb)
            """
        ),
        {
            "id": pid,
            "slug": f"rr-test-{pid.hex[:8]}",
            "name": "RR Test Project",
            "org": "test-org",
        },
    )
    await session.commit()
    return pid


async def _make_user(session: AsyncSession) -> uuid.UUID:
    """Insert a minimal user row; return its UUID."""
    uid = uuid.uuid4()
    await session.execute(
        sa.text(
            """
            INSERT INTO users (id, email, hashed_password, display_name, is_active)
            VALUES (:id, :email, 'x', 'Test User', true)
            """
        ),
        {"id": uid, "email": f"user-{uid.hex[:8]}@test.example"},
    )
    await session.commit()
    return uid


async def _make_plan(
    session: AsyncSession,
    project_id: uuid.UUID,
    wid: str,
    title: str = "Test Plan",
    explicit_add: list[str] | None = None,
) -> uuid.UUID:
    """Insert a plan content row; return its UUID."""
    plan_id = uuid.uuid4()
    body = {
        "title": title,
        "include": {},
        "exclude": {},
        "suite_refs": [],
        "explicit_cases": {"add": explicit_add or [], "remove": []},
    }
    await session.execute(
        sa.text(
            """
            INSERT INTO content
                (id, project_id, kind, wombat_id, title, tags, body,
                 source_repo, source_path, source_revision, content_hash)
            VALUES
                (:id, :pid, 'plan', :wid, :title, '[]'::jsonb, :body,
                 'repo', :path, 'rev1', :ch)
            """
        ),
        {
            "id": plan_id,
            "pid": project_id,
            "wid": wid,
            "title": title,
            "body": json.dumps(body),
            "path": f"plans/{wid}.yaml",
            "ch": f"hash-{wid}",
        },
    )
    await session.commit()
    return plan_id


async def _make_testcase(
    session: AsyncSession,
    project_id: uuid.UUID,
    wid: str,
    title: str | None = None,
) -> uuid.UUID:
    """Insert a testcase content row; return its UUID."""
    tc_id = uuid.uuid4()
    body = {"title": title or f"Case {wid}"}
    await session.execute(
        sa.text(
            """
            INSERT INTO content
                (id, project_id, kind, wombat_id, title, tags, body,
                 source_repo, source_path, source_revision, content_hash)
            VALUES
                (:id, :pid, 'testcase', :wid, :title, '[]'::jsonb, :body,
                 'repo', :path, 'rev1', :ch)
            """
        ),
        {
            "id": tc_id,
            "pid": project_id,
            "wid": wid,
            "title": title or f"Case {wid}",
            "body": json.dumps(body),
            "path": f"testcases/{wid}.md",
            "ch": f"hash-tc-{wid}",
        },
    )
    await session.commit()
    return tc_id


async def _make_run(
    session: AsyncSession,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    plan_db_id: uuid.UUID,
    title: str = "Test Run",
) -> uuid.UUID:
    """Insert a run linked to a plan; return run UUID."""
    run_id = uuid.uuid4()
    await session.execute(
        sa.text(
            """
            INSERT INTO runs (id, project_id, title, status, source, owner_id, plan_id)
            VALUES (:id, :pid, :title, 'open', 'manual', :owner, :plan_id)
            """
        ),
        {
            "id": run_id,
            "pid": project_id,
            "title": title,
            "owner": owner_id,
            "plan_id": plan_db_id,
        },
    )
    await session.commit()
    return run_id


async def _make_snapshot_and_run_case(
    session: AsyncSession,
    run_id: uuid.UUID,
    owner_id: uuid.UUID,
    content_id: uuid.UUID,
    snapshot_wombat_id: str,
    display_order: int = 0,
) -> uuid.UUID:
    """Insert a run_case_snapshot + run_case; return run_case UUID."""
    snap_id = uuid.uuid4()
    content_hash = f"snap-{snapshot_wombat_id}-{run_id.hex[:6]}"
    await session.execute(
        sa.text(
            """
            INSERT INTO run_case_snapshots
                (id, content_hash, content_id, snapshot_body, snapshot_title, snapshot_wombat_id)
            VALUES
                (:id, :ch, :cid, :body, :title, :wid)
            ON CONFLICT (content_hash) DO NOTHING
            """
        ),
        {
            "id": snap_id,
            "ch": content_hash,
            "cid": content_id,
            "body": json.dumps({"title": f"Snapshot of {snapshot_wombat_id}"}),
            "title": f"Snapshot of {snapshot_wombat_id}",
            "wid": snapshot_wombat_id,
        },
    )
    # Fetch the actual snapshot id (may have been overridden by ON CONFLICT)
    row = (
        await session.execute(
            sa.text("SELECT id FROM run_case_snapshots WHERE content_hash = :ch"),
            {"ch": content_hash},
        )
    ).first()
    actual_snap_id = row.id if row else snap_id

    rc_id = uuid.uuid4()
    await session.execute(
        sa.text(
            """
            INSERT INTO run_cases (id, run_id, snapshot_id, display_order, added_by_user_id)
            VALUES (:id, :run_id, :snap_id, :order, :user_id)
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "id": rc_id,
            "run_id": run_id,
            "snap_id": actual_snap_id,
            "order": display_order,
            "user_id": owner_id,
        },
    )
    await session.commit()
    return rc_id


async def _make_result(
    session: AsyncSession,
    run_id: uuid.UUID,
    run_case_id: uuid.UUID,
    owner_id: uuid.UUID,
    status: str,
    updated_at: datetime | None = None,
) -> uuid.UUID:
    """Insert a result row; return its UUID."""
    result_id = uuid.uuid4()
    ts = updated_at or datetime.now(UTC)
    await session.execute(
        sa.text(
            """
            INSERT INTO results
                (id, run_id, run_case_id, status, source, revision, recorded_by_user_id,
                 created_at, updated_at)
            VALUES
                (:id, :run_id, :rc_id, :status, 'manual', 1, :user_id, :ts, :ts)
            ON CONFLICT (run_id, run_case_id) DO UPDATE
                SET status     = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "id": result_id,
            "run_id": run_id,
            "rc_id": run_case_id,
            "status": status,
            "user_id": owner_id,
            "ts": ts,
        },
    )
    await session.commit()
    return result_id


# ---------------------------------------------------------------------------
# Simple dataclass to hold seeded fixture state
# ---------------------------------------------------------------------------


class _Seed:
    project_id: uuid.UUID
    user_id: uuid.UUID
    plan_wid: str
    plan_db_id: uuid.UUID
    case_wids: list[str]
    case_db_ids: list[uuid.UUID]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seed_zero_runs(db_session: AsyncSession):
    """Project + plan with 3 cases but zero runs."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-RR-{uuid.uuid4().hex[:6].upper()}"
    case_wids = [f"TC-RR-A-{uuid.uuid4().hex[:4].upper()}", f"TC-RR-B-{uuid.uuid4().hex[:4].upper()}"]
    for cwid in case_wids:
        await _make_testcase(db_session, pid, cwid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=case_wids)
    seed = _Seed()
    seed.project_id = pid
    seed.user_id = uid
    seed.plan_wid = plan_wid
    seed.plan_db_id = plan_db_id
    seed.case_wids = case_wids
    seed.case_db_ids = []
    return seed


@pytest_asyncio.fixture
async def seed_with_results(db_session: AsyncSession):
    """Project + plan + run + results (1 pass, 1 fail)."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-RR-{uuid.uuid4().hex[:6].upper()}"
    case_wids = [f"TC-RR-P-{uuid.uuid4().hex[:4].upper()}", f"TC-RR-F-{uuid.uuid4().hex[:4].upper()}"]
    case_db_ids = []
    for cwid in case_wids:
        cid = await _make_testcase(db_session, pid, cwid)
        case_db_ids.append(cid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=case_wids)
    run_id = await _make_run(db_session, pid, uid, plan_db_id)
    rc_ids = []
    for i, (cwid, cid) in enumerate(zip(case_wids, case_db_ids, strict=True)):
        rc_id = await _make_snapshot_and_run_case(db_session, run_id, uid, cid, cwid, i)
        rc_ids.append(rc_id)
    await _make_result(db_session, run_id, rc_ids[0], uid, "pass")
    await _make_result(db_session, run_id, rc_ids[1], uid, "fail")
    seed = _Seed()
    seed.project_id = pid
    seed.user_id = uid
    seed.plan_wid = plan_wid
    seed.plan_db_id = plan_db_id
    seed.case_wids = case_wids
    seed.case_db_ids = case_db_ids
    return seed


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_zero_runs_returns_all_not_run(
    db_session: AsyncSession, seed_zero_runs: _Seed
):
    """With no runs, executed_pct == 0.0 and every case is not_run."""
    seed = seed_zero_runs
    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(seed.project_id),
        "plan_wombat_id": seed.plan_wid,
    }
    filters: WidgetFilters = {}
    result = await _query(scope, filters, db_session)

    assert result["plan_id"] == seed.plan_wid
    assert result["executed_pct"] == 0.0
    assert result["pass_pct"] == 0.0
    assert result["by_status"]["not_run"] == len(seed.case_wids)
    assert result["by_status"]["pass"] == 0
    assert result["by_status"]["fail"] == 0
    assert result["blockers"] == []


@pytest.mark.asyncio
async def test_basic_pass_and_fail_metrics(
    db_session: AsyncSession, seed_with_results: _Seed
):
    """1 pass + 1 fail → executed_pct == 1.0, pass_pct == 0.5."""
    seed = seed_with_results
    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(seed.project_id),
        "plan_wombat_id": seed.plan_wid,
    }
    filters: WidgetFilters = {}
    result = await _query(scope, filters, db_session)

    assert result["executed_pct"] == pytest.approx(1.0)
    assert result["pass_pct"] == pytest.approx(0.5)
    assert result["by_status"]["pass"] == 1
    assert result["by_status"]["fail"] == 1
    assert result["by_status"]["not_run"] == 0
    # The fail case should appear in blockers.
    assert len(result["blockers"]) == 1
    assert result["blockers"][0]["status"] == "fail"


@pytest.mark.asyncio
async def test_latest_result_wins(db_session: AsyncSession):
    """A case with an earlier fail and later pass is counted as pass."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-LATEST-{uuid.uuid4().hex[:6].upper()}"
    case_wid = f"TC-LATEST-{uuid.uuid4().hex[:6].upper()}"
    cid = await _make_testcase(db_session, pid, case_wid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=[case_wid])

    # Two runs — first records a fail, second records a pass.
    run1_id = await _make_run(db_session, pid, uid, plan_db_id, "Run 1")
    rc1_id = await _make_snapshot_and_run_case(db_session, run1_id, uid, cid, case_wid, 0)
    earlier = datetime(2025, 1, 1, 12, 0, 0, tzinfo=UTC)
    await _make_result(db_session, run1_id, rc1_id, uid, "fail", updated_at=earlier)

    run2_id = await _make_run(db_session, pid, uid, plan_db_id, "Run 2")
    rc2_id = await _make_snapshot_and_run_case(db_session, run2_id, uid, cid, case_wid, 0)
    later = datetime(2025, 6, 1, 12, 0, 0, tzinfo=UTC)
    await _make_result(db_session, run2_id, rc2_id, uid, "pass", updated_at=later)

    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": plan_wid,
    }
    result = await _query(scope, {}, db_session)

    assert result["by_status"]["pass"] == 1
    assert result["by_status"]["fail"] == 0
    assert result["blockers"] == [], "pass should not appear as a blocker"


@pytest.mark.asyncio
async def test_blockers_bounded_to_25(db_session: AsyncSession):
    """When more than 25 cases have fail/blocked status, blockers is capped at 25."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-BLOCKERS-{uuid.uuid4().hex[:6].upper()}"
    n_cases = 30  # intentionally > 25
    case_wids = [f"TC-BLK-{i:03d}-{uuid.uuid4().hex[:4].upper()}" for i in range(n_cases)]
    case_db_ids = []
    for cwid in case_wids:
        cid = await _make_testcase(db_session, pid, cwid)
        case_db_ids.append(cid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=case_wids)

    run_id = await _make_run(db_session, pid, uid, plan_db_id)
    for i, (cwid, cid) in enumerate(zip(case_wids, case_db_ids, strict=True)):
        rc_id = await _make_snapshot_and_run_case(db_session, run_id, uid, cid, cwid, i)
        await _make_result(db_session, run_id, rc_id, uid, "fail")

    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": plan_wid,
    }
    result = await _query(scope, {}, db_session)

    assert len(result["blockers"]) == 25, (
        f"Expected 25 blockers (bounded), got {len(result['blockers'])}"
    )
    assert result["by_status"]["fail"] == n_cases


@pytest.mark.asyncio
async def test_project_scope_uses_filters_plan_id(
    db_session: AsyncSession, seed_with_results: _Seed
):
    """project scope with filters.plan_id returns the same metrics as plan scope."""
    seed = seed_with_results
    scope_plan: WidgetScope = {
        "kind": "plan",
        "project_id": str(seed.project_id),
        "plan_wombat_id": seed.plan_wid,
    }
    scope_project: WidgetScope = {
        "kind": "project",
        "project_id": str(seed.project_id),
        "plan_wombat_id": None,
    }
    filters: WidgetFilters = {"plan_id": seed.plan_wid}

    result_plan = await _query(scope_plan, {}, db_session)
    result_project = await _query(scope_project, filters, db_session)

    assert result_plan["executed_pct"] == result_project["executed_pct"]
    assert result_plan["pass_pct"] == result_project["pass_pct"]
    assert result_plan["by_status"] == result_project["by_status"]


@pytest.mark.asyncio
async def test_project_scope_without_plan_id_raises_400(
    db_session: AsyncSession, seed_zero_runs: _Seed
):
    """project scope with no plan_id filter raises HTTPException(400)."""
    from fastapi import HTTPException

    seed = seed_zero_runs
    scope: WidgetScope = {
        "kind": "project",
        "project_id": str(seed.project_id),
        "plan_wombat_id": None,
    }
    with pytest.raises(HTTPException) as exc_info:
        await _query(scope, {}, db_session)
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_missing_plan_returns_empty_response(db_session: AsyncSession):
    """An unrecognised plan wombat_id returns zeroed metrics, not a 404."""
    pid = await _make_project(db_session)
    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": "PLAN-DOES-NOT-EXIST",
    }
    result = await _query(scope, {}, db_session)

    assert result["plan_id"] == "PLAN-DOES-NOT-EXIST"
    assert result["executed_pct"] == 0.0
    assert result["pass_pct"] == 0.0
    assert result["blockers"] == []


@pytest.mark.asyncio
async def test_registry_includes_release_readiness():
    """REGISTRY.list_meta() includes the release_readiness slug."""
    slugs = {m["slug"] for m in REGISTRY.list_meta()}
    assert "release_readiness" in slugs


@pytest.mark.asyncio
async def test_meta_scope_kinds():
    """META declares both project and plan scope_kinds."""
    assert "project" in META["scope_kinds"]
    assert "plan" in META["scope_kinds"]


@pytest.mark.asyncio
async def test_meta_requires_plan_id():
    """META.requires contains plan_id so the route dispatcher can enforce it."""
    assert "plan_id" in META["requires"]


@pytest.mark.asyncio
async def test_blocked_status_counted_as_blocker(db_session: AsyncSession):
    """Cases with latest result = 'blocked' appear in blockers list."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-BLKD-{uuid.uuid4().hex[:6].upper()}"
    case_wid = f"TC-BLKD-{uuid.uuid4().hex[:6].upper()}"
    cid = await _make_testcase(db_session, pid, case_wid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=[case_wid])
    run_id = await _make_run(db_session, pid, uid, plan_db_id)
    rc_id = await _make_snapshot_and_run_case(db_session, run_id, uid, cid, case_wid, 0)
    await _make_result(db_session, run_id, rc_id, uid, "blocked")

    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": plan_wid,
    }
    result = await _query(scope, {}, db_session)

    assert result["by_status"]["blocked"] == 1
    assert any(b["wombat_id"] == case_wid for b in result["blockers"])


@pytest.mark.asyncio
async def test_skipped_not_in_blockers(db_session: AsyncSession):
    """Skipped cases do not appear in the blockers list."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)
    plan_wid = f"PLAN-SKIP-{uuid.uuid4().hex[:6].upper()}"
    case_wid = f"TC-SKIP-{uuid.uuid4().hex[:6].upper()}"
    cid = await _make_testcase(db_session, pid, case_wid)
    plan_db_id = await _make_plan(db_session, pid, plan_wid, explicit_add=[case_wid])
    run_id = await _make_run(db_session, pid, uid, plan_db_id)
    rc_id = await _make_snapshot_and_run_case(db_session, run_id, uid, cid, case_wid, 0)
    await _make_result(db_session, run_id, rc_id, uid, "skipped")

    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": plan_wid,
    }
    result = await _query(scope, {}, db_session)

    assert result["by_status"]["skipped"] == 1
    assert result["blockers"] == [], "skipped should not be a blocker"


@pytest.mark.asyncio
async def test_runs_from_other_plan_not_included(db_session: AsyncSession):
    """Results from runs with a different plan_id do not affect the target plan's metrics."""
    pid = await _make_project(db_session)
    uid = await _make_user(db_session)

    # Plan A with one case
    plan_a_wid = f"PLAN-A-{uuid.uuid4().hex[:6].upper()}"
    case_wid = f"TC-SHARED-{uuid.uuid4().hex[:6].upper()}"
    cid = await _make_testcase(db_session, pid, case_wid)
    plan_a_id = await _make_plan(db_session, pid, plan_a_wid, explicit_add=[case_wid])

    # Plan B with the same case
    plan_b_wid = f"PLAN-B-{uuid.uuid4().hex[:6].upper()}"
    plan_b_id = await _make_plan(db_session, pid, plan_b_wid, explicit_add=[case_wid])

    # Run under Plan B records a fail
    run_b_id = await _make_run(db_session, pid, uid, plan_b_id, "Run B")
    rc_b_id = await _make_snapshot_and_run_case(db_session, run_b_id, uid, cid, case_wid, 0)
    await _make_result(db_session, run_b_id, rc_b_id, uid, "fail")

    # Query Plan A — should show not_run (Plan B's results must not bleed in)
    scope: WidgetScope = {
        "kind": "plan",
        "project_id": str(pid),
        "plan_wombat_id": plan_a_wid,
    }
    result = await _query(scope, {}, db_session)

    assert result["by_status"]["not_run"] == 1
    assert result["by_status"]["fail"] == 0
    assert result["executed_pct"] == 0.0
