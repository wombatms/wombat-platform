"""Unit tests for ResolveService.resolve_plan and ResolveService.resolve_suite.

Test placement rationale
------------------------
These tests live in ``tests/unit/api/`` and use the SQLite in-memory session
from the shared conftest.  They rely on ``ResolveService._match_filter``'s
Python-side fallback (which activates automatically when the session dialect
is ``sqlite``), so no Postgres / testcontainers is required.

The recursive-CTE Postgres path for ``list_suite_subtree`` is exercised
separately in ``tests/integration/api/test_repository_subtree_pg.py``.

DepthLimitError
---------------
Defined in ``wombat_api.planning.service`` (co-located with ResolveService,
consistent with the existing pattern where repository errors live in
repository.py).  Tests import it from that module directly.

add/remove/exclude composition
-------------------------------
- ``explicit_cases.add`` wins over filter/suite_ref in the source label
  (setdefault semantics) — but the case IS included regardless of which
  source flag it carries.
- ``explicit_cases.remove`` and ``exclude`` filter subtractions happen after
  the union is built, so remove wins over add when a case appears in both.
- A case explicitly added that has no live content row is dropped from the
  final list with an UNKNOWN_CASE_ID warning.

Project isolation
-----------------
A separate project fixture is used to seed "contaminating" rows; the service
must never return those rows.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from wombat_api.database.engine import Base
from wombat_api.database.models import Content, ProjectDB
from wombat_api.database.repository import Repository
from wombat_api.planning.service import DepthLimitError, ResolveService

# ---------------------------------------------------------------------------
# DB fixtures (SQLite in-memory)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session():
    """Fresh SQLite in-memory async session with full schema."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        yield s
    await engine.dispose()


@pytest_asyncio.fixture
async def project(db_session) -> ProjectDB:
    proj = ProjectDB(
        id=uuid.uuid4(),
        slug="resolve-tests",
        name="Resolve Tests",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(proj)
    await db_session.flush()
    return proj


@pytest_asyncio.fixture
async def other_project(db_session) -> ProjectDB:
    """A second project — rows here must never appear in resolve results."""
    proj = ProjectDB(
        id=uuid.uuid4(),
        slug="other-proj",
        name="Other Project",
        taxonomy_components=[],
        taxonomy_environments=[],
    )
    db_session.add(proj)
    await db_session.flush()
    return proj


@pytest_asyncio.fixture
async def repo(db_session) -> Repository:
    return Repository(db_session)


# ---------------------------------------------------------------------------
# Content-creation helpers
# ---------------------------------------------------------------------------


async def _make_testcase(
    db_session,
    project: ProjectDB,
    wombat_id: str,
    tags: list[str] | None = None,
    priority: str = "medium",
    component: str = "core",
    title: str | None = None,
) -> Content:
    """Create a minimal testcase Content row."""
    row_tags = tags or []
    body = {
        "id": wombat_id,
        "title": title or wombat_id,
        "priority": priority,
        "component": component,
        "tags": row_tags,
        "owner": "qa",
        "steps": [],
    }
    row = Content(
        id=uuid.uuid4(),
        project_id=project.id,
        kind="testcase",
        wombat_id=wombat_id,
        title=title or wombat_id,
        tags=row_tags,
        body=body,
        source_repo="test-repo",
        source_path=f"cases/{wombat_id}.md",
        source_revision="rev-1",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _make_suite(
    db_session,
    project: ProjectDB,
    wombat_id: str,
    cases: list[str] | None = None,
    parent: str | None = None,
    include: dict | None = None,
    title: str | None = None,
) -> Content:
    """Create a minimal suite Content row."""
    body: dict = {
        "id": wombat_id,
        "title": title or wombat_id,
        "owner": "qa",
        "cases": cases or [],
        "include": include or {},
    }
    if parent is not None:
        body["parent_wombat_id"] = parent
    row = Content(
        id=uuid.uuid4(),
        project_id=project.id,
        kind="suite",
        wombat_id=wombat_id,
        title=title or wombat_id,
        tags=[],
        body=body,
        source_repo="test-repo",
        source_path=f"suites/{wombat_id}.yml",
        source_revision="rev-1",
        content_hash=f"hash-{wombat_id}-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(row)
    await db_session.flush()
    return row


# ---------------------------------------------------------------------------
# Seed fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seed(db_session, project):
    """Two 'payments' testcases + one 'auth' testcase + one extra testcase."""
    tc1 = await _make_testcase(
        db_session, project, "TC-PAY-1", tags=["payments"], priority="high", component="payments"
    )
    tc2 = await _make_testcase(
        db_session, project, "TC-PAY-2", tags=["payments"], priority="medium", component="payments"
    )
    tc_auth = await _make_testcase(
        db_session, project, "TC-AUTH-1", tags=["auth"], priority="high", component="auth"
    )
    tc_extra = await _make_testcase(
        db_session, project, "TC-EXTRA", tags=["misc"], priority="low", component="misc"
    )
    return {"tc1": tc1, "tc2": tc2, "tc_auth": tc_auth, "tc_extra": tc_extra}


@pytest_asyncio.fixture
async def seed_suites(db_session, project):
    """A two-level suite hierarchy with testcases."""
    await _make_testcase(db_session, project, "TC-CHECKOUT-1", tags=["checkout"])
    await _make_testcase(db_session, project, "TC-CHECKOUT-CHILD-1", tags=["checkout"])
    await _make_suite(
        db_session, project, "SUITE-CHECKOUT-CHILD",
        cases=["TC-CHECKOUT-CHILD-1"],
    )
    await _make_suite(
        db_session, project, "SUITE-CHECKOUT",
        cases=["TC-CHECKOUT-1"],
        # SUITE-CHECKOUT-CHILD is a child (parent_wombat_id="SUITE-CHECKOUT").
    )
    # Wire child under parent via parent_wombat_id in the child's body.
    # We must update the child row we just created.
    from sqlalchemy import select
    child_q = select(Content).where(Content.wombat_id == "SUITE-CHECKOUT-CHILD")
    child_row = (await db_session.execute(child_q)).scalar_one()
    child_body = dict(child_row.body)
    child_body["parent_wombat_id"] = "SUITE-CHECKOUT"
    child_row.body = child_body
    await db_session.flush()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _plan_body(
    tags_any: list[str] | None = None,
    exclude_tags: list[str] | None = None,
    suite_refs: list[str] | None = None,
    add: list[str] | None = None,
    remove: list[str] | None = None,
    priorities: list[str] | None = None,
    components_any: list[str] | None = None,
) -> dict:
    """Build a minimal plan body dict for test assertions."""
    include: dict = {}
    if tags_any:
        include["tags_any"] = tags_any
    if priorities:
        include["priorities"] = priorities
    if components_any:
        include["components_any"] = components_any
    exclude: dict = {}
    if exclude_tags:
        exclude["tags_any"] = exclude_tags
    return {
        "title": "test plan",
        "include": include,
        "exclude": exclude,
        "suite_refs": suite_refs or [],
        "explicit_cases": {"add": add or [], "remove": remove or []},
    }


# ===========================================================================
# resolve_plan tests
# ===========================================================================


async def test_resolve_plan_filter_tags_any(repo, project, seed):
    """Filter by tags_any returns only matching testcases."""
    body = _plan_body(tags_any=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert {c.wombat_id for c in out.cases} == {"TC-PAY-1", "TC-PAY-2"}
    assert out.count == 2
    assert out.warnings == []


async def test_resolve_plan_filter_priority(repo, project, seed):
    """Filter by priorities returns only matching testcases."""
    body = _plan_body(priorities=["high"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    # TC-PAY-1 and TC-AUTH-1 are priority=high.
    assert {c.wombat_id for c in out.cases} == {"TC-PAY-1", "TC-AUTH-1"}


async def test_resolve_plan_filter_components_any(repo, project, seed):
    """Filter by components_any returns only matching testcases."""
    body = _plan_body(components_any=["auth"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert {c.wombat_id for c in out.cases} == {"TC-AUTH-1"}


async def test_resolve_plan_explicit_add_extends_filter(repo, project, seed):
    """explicit_cases.add brings in a case beyond what the filter matches."""
    body = _plan_body(tags_any=["payments"], add=["TC-AUTH-1"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert {c.wombat_id for c in out.cases} == {"TC-PAY-1", "TC-PAY-2", "TC-AUTH-1"}


async def test_resolve_plan_explicit_remove_subtracts(repo, project, seed):
    """explicit_cases.remove removes a case that the filter would include."""
    body = _plan_body(tags_any=["payments"], remove=["TC-PAY-1"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert {c.wombat_id for c in out.cases} == {"TC-PAY-2"}


async def test_resolve_plan_explicit_add_and_remove_compose(repo, project, seed):
    """add + remove: TC-EXTRA added; TC-PAY-1 removed from filter set."""
    body = _plan_body(tags_any=["payments"], add=["TC-EXTRA"], remove=["TC-PAY-1"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert {c.wombat_id for c in out.cases} == {"TC-PAY-2", "TC-EXTRA"}


async def test_resolve_plan_remove_wins_over_add(repo, project, seed):
    """When the same ID is in both add and remove, remove wins."""
    body = _plan_body(add=["TC-AUTH-1"], remove=["TC-AUTH-1"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert "TC-AUTH-1" not in {c.wombat_id for c in out.cases}


async def test_resolve_plan_suite_refs_recursive(repo, project, seed_suites):
    """suite_refs resolves the subtree and includes all descendent cases."""
    body = _plan_body(suite_refs=["SUITE-CHECKOUT"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    wids = {c.wombat_id for c in out.cases}
    # SUITE-CHECKOUT has TC-CHECKOUT-1; its child SUITE-CHECKOUT-CHILD has TC-CHECKOUT-CHILD-1.
    assert "TC-CHECKOUT-1" in wids
    assert "TC-CHECKOUT-CHILD-1" in wids


async def test_resolve_plan_suite_ref_source_label(repo, project, seed_suites):
    """Cases contributed by a suite_ref carry the suite_ref:<id> source label."""
    body = _plan_body(suite_refs=["SUITE-CHECKOUT"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    for case in out.cases:
        assert case.source == "suite_ref:SUITE-CHECKOUT"


async def test_resolve_plan_filter_source_label(repo, project, seed):
    """Cases contributed by the include filter carry the 'filter' source label."""
    body = _plan_body(tags_any=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    for case in out.cases:
        assert case.source == "filter"


async def test_resolve_plan_explicit_add_source_label(repo, project, seed):
    """Cases contributed by explicit_add carry the 'explicit_add' source label."""
    body = _plan_body(add=["TC-AUTH-1"])  # no filter; explicit_add only
    out = await ResolveService(repo).resolve_plan(project.id, body)
    tc = next(c for c in out.cases if c.wombat_id == "TC-AUTH-1")
    assert tc.source == "explicit_add"


async def test_resolve_plan_filter_wins_source_label_over_suite(
    repo, project, seed, seed_suites
):
    """When a case appears in both filter and suite_ref, filter source wins (first-writer)."""
    # TC-CHECKOUT-1 has tag "checkout"; add it to filter too.
    await _make_testcase(
        db_session=repo.session,
        project=project,
        wombat_id="TC-DUAL",
        tags=["checkout"],
    )
    # Wire TC-DUAL into the checkout suite explicitly.
    from sqlalchemy import select

    suite_q = select(Content).where(Content.wombat_id == "SUITE-CHECKOUT")
    suite_row = (await repo.session.execute(suite_q)).scalar_one()
    suite_body = dict(suite_row.body)
    suite_body["cases"] = list(suite_body.get("cases") or []) + ["TC-DUAL"]
    suite_row.body = suite_body
    await repo.session.flush()

    body = _plan_body(tags_any=["checkout"], suite_refs=["SUITE-CHECKOUT"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    dual = next((c for c in out.cases if c.wombat_id == "TC-DUAL"), None)
    assert dual is not None
    assert dual.source == "filter"  # filter registered first in sources dict


async def test_resolve_plan_unknown_suite_ref_warning(repo, project):
    """Unknown suite_ref produces UNKNOWN_SUITE_REF warning; no error."""
    body = _plan_body(suite_refs=["SUITE-DOES-NOT-EXIST"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert out.cases == []
    codes = {w.code for w in out.warnings}
    assert "UNKNOWN_SUITE_REF" in codes


async def test_resolve_plan_unknown_case_id_warning(repo, project):
    """Unknown explicit_cases.add ID produces UNKNOWN_CASE_ID warning; no error."""
    body = _plan_body(add=["TC-DOES-NOT-EXIST"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    codes = {w.code for w in out.warnings}
    assert "UNKNOWN_CASE_ID" in codes
    # The unknown case must not appear in the resolved output.
    assert "TC-DOES-NOT-EXIST" not in {c.wombat_id for c in out.cases}


async def test_resolve_plan_unknown_suite_and_case_warnings_together(repo, project):
    """Both UNKNOWN_SUITE_REF and UNKNOWN_CASE_ID can appear in the same resolution."""
    body = _plan_body(suite_refs=["SUITE-MISSING"], add=["TC-MISSING"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    codes = {w.code for w in out.warnings}
    assert "UNKNOWN_SUITE_REF" in codes
    assert "UNKNOWN_CASE_ID" in codes


async def test_resolve_plan_deterministic_order(repo, project, seed):
    """Repeated resolve calls return cases in the same wombat_id-sorted order."""
    body = _plan_body(tags_any=["payments"])
    svc = ResolveService(repo)
    out1 = await svc.resolve_plan(project.id, body)
    out2 = await svc.resolve_plan(project.id, body)
    assert [c.wombat_id for c in out1.cases] == [c.wombat_id for c in out2.cases]
    # Also assert the order is lexicographic by wombat_id.
    wids = [c.wombat_id for c in out1.cases]
    assert wids == sorted(wids)


async def test_resolve_plan_empty_filter_empty_result(repo, project, seed):
    """A plan with no include filter and no suite_refs and no explicit_add → empty."""
    body = _plan_body()
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert out.cases == []
    assert out.count == 0


async def test_resolve_plan_project_isolation(repo, project, other_project, db_session):
    """Cases from another project must never appear in resolve results."""
    await _make_testcase(
        db_session, other_project, "TC-OTHER", tags=["payments"]
    )
    await _make_testcase(
        db_session, project, "TC-MINE", tags=["payments"]
    )
    body = _plan_body(tags_any=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    wids = {c.wombat_id for c in out.cases}
    assert "TC-MINE" in wids
    assert "TC-OTHER" not in wids


async def test_resolve_plan_exclude_filter(repo, project, seed):
    """exclude filter subtracts matching cases from the base set."""
    # payments tag pulls in TC-PAY-1, TC-PAY-2.  Exclude priority=high → drops TC-PAY-1.
    body = _plan_body(tags_any=["payments"], exclude_tags=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    # All payments cases are excluded because the exclude filter also matches by tag.
    assert out.cases == []


async def test_resolve_plan_exclude_narrows_not_expands(repo, project, seed):
    """Exclude only subtracts from the base; it never adds cases."""
    # Include nothing; exclude payments.  Result must still be empty.
    body = _plan_body(exclude_tags=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert out.cases == []


async def test_resolve_plan_title_populated(repo, project, seed):
    """Resolved cases carry the title from the content row."""
    body = _plan_body(tags_any=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    for case in out.cases:
        # Default title is wombat_id when no explicit title is given in seed.
        assert case.title  # non-empty
        assert case.wombat_id  # sanity


# ===========================================================================
# resolve_suite tests
# ===========================================================================


async def test_resolve_suite_single_suite(repo, project, db_session):
    """resolve_suite for a leaf suite returns its explicit cases."""
    await _make_testcase(db_session, project, "TC-S1")
    await _make_testcase(db_session, project, "TC-S2")
    await _make_suite(db_session, project, "SUITE-LEAF", cases=["TC-S1", "TC-S2"])

    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-LEAF")
    assert {c.wombat_id for c in out.cases} == {"TC-S1", "TC-S2"}
    assert out.count == 2


async def test_resolve_suite_includes_subtree(repo, project, seed_suites):
    """resolve_suite aggregates cases from the root and all descendants."""
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-CHECKOUT")
    wids = {c.wombat_id for c in out.cases}
    assert "TC-CHECKOUT-1" in wids
    assert "TC-CHECKOUT-CHILD-1" in wids


async def test_resolve_suite_source_label(repo, project, seed_suites):
    """All cases from resolve_suite carry source='suite_ref:<root>'."""
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-CHECKOUT")
    for case in out.cases:
        assert case.source == "suite_ref:SUITE-CHECKOUT"


async def test_resolve_suite_unknown_root_warning(repo, project):
    """resolve_suite on a non-existent root emits UNKNOWN_SUITE_REF warning."""
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-MISSING")
    assert out.cases == []
    codes = {w.code for w in out.warnings}
    assert "UNKNOWN_SUITE_REF" in codes


async def test_resolve_suite_deterministic_order(repo, project, seed_suites):
    """resolve_suite returns cases in wombat_id-sorted order."""
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-CHECKOUT")
    wids = [c.wombat_id for c in out.cases]
    assert wids == sorted(wids)


async def test_resolve_suite_project_isolation(repo, project, other_project, db_session):
    """Cases from another project's suite never bleed into resolve_suite."""
    await _make_testcase(db_session, other_project, "TC-CONTAMINANT")
    await _make_suite(
        db_session, other_project, "SUITE-OTHER", cases=["TC-CONTAMINANT"]
    )
    await _make_testcase(db_session, project, "TC-MINE-S")
    await _make_suite(
        db_session, project, "SUITE-MINE", cases=["TC-MINE-S"]
    )

    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-MINE")
    wids = {c.wombat_id for c in out.cases}
    assert "TC-MINE-S" in wids
    assert "TC-CONTAMINANT" not in wids


# ---------------------------------------------------------------------------
# DepthLimitError
# ---------------------------------------------------------------------------


async def test_depth_limit_error_raised_by_resolve_suite(repo, project, db_session):
    """_resolve_suite raises DepthLimitError when depth > 20.

    We invoke _resolve_suite directly with depth=21 to trigger the guard
    without needing to build a 21-level deep hierarchy in the test DB.
    """
    svc = ResolveService(repo)
    warnings: list = []
    with pytest.raises(DepthLimitError):
        await svc._resolve_suite(project.id, "SUITE-ANY", warnings, depth=21)


async def test_depth_limit_error_has_wombat_id(repo, project):
    """DepthLimitError carries the wombat_id that triggered the limit."""
    svc = ResolveService(repo)
    warnings: list = []
    with pytest.raises(DepthLimitError) as exc_info:
        await svc._resolve_suite(project.id, "SUITE-XYZ", warnings, depth=21)
    assert exc_info.value.wombat_id == "SUITE-XYZ"


async def test_depth_limit_error_is_exception():
    """DepthLimitError is a proper Exception subclass."""
    err = DepthLimitError("SUITE-A")
    assert isinstance(err, Exception)
    assert "SUITE-A" in str(err)


# ---------------------------------------------------------------------------
# Suite filter-based case inclusion
# ---------------------------------------------------------------------------


async def test_suite_include_filter_contributes_cases(repo, project, db_session):
    """A suite whose body has an 'include' filter contributes matching cases."""
    await _make_testcase(
        db_session, project, "TC-FILTERED-1", tags=["checkout"], priority="high"
    )
    await _make_testcase(
        db_session, project, "TC-FILTERED-2", tags=["checkout"], priority="low"
    )
    # Suite with an include filter (no explicit cases).
    await _make_suite(
        db_session, project, "SUITE-FILTER",
        cases=[],
        include={"tags_any": ["checkout"]},
    )
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-FILTER")
    wids = {c.wombat_id for c in out.cases}
    assert "TC-FILTERED-1" in wids
    assert "TC-FILTERED-2" in wids


async def test_suite_cases_and_filter_union(repo, project, db_session):
    """A suite with both explicit cases and an include filter — the union is returned."""
    await _make_testcase(db_session, project, "TC-EXPLICIT")
    await _make_testcase(db_session, project, "TC-FILTER-MATCH", tags=["regression"])
    await _make_suite(
        db_session, project, "SUITE-COMBINED",
        cases=["TC-EXPLICIT"],
        include={"tags_any": ["regression"]},
    )
    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-COMBINED")
    wids = {c.wombat_id for c in out.cases}
    assert "TC-EXPLICIT" in wids
    assert "TC-FILTER-MATCH" in wids


# ===========================================================================
# Task 20: Edge-case coverage (SP3.4)
# ===========================================================================


async def test_exclude_beats_explicit_add(repo, project, seed):
    """When a case is in both explicit_add and the exclude filter, exclude wins.

    Composition order (spec §4.4):
      1. filter_set → sources
      2. suite_set (setdefault)
      3. explicit_add (setdefault)
      4. subtract: exclude_set | remove_ids

    So even though TC-AUTH-1 is in explicit_add, the exclude filter runs after
    and removes it from sources.
    """
    # explicit_add=TC-AUTH-1; exclude=tags_any:["auth"] → TC-AUTH-1 excluded.
    body = _plan_body(add=["TC-AUTH-1"], exclude_tags=["auth"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    wids = {c.wombat_id for c in out.cases}
    assert "TC-AUTH-1" not in wids, "exclude_set must beat explicit_add"
    # Nothing else should appear either (no include filter).
    assert out.cases == []


async def test_deleted_content_rows_excluded(repo, project, db_session, seed):
    """Soft-deleted content rows (deleted_at IS NOT NULL) must not appear in resolved output.

    The _match_filter query already includes ``Content.deleted_at.is_(None)``.
    This test asserts the semantic at the resolve level.
    """
    from datetime import UTC, datetime

    from sqlalchemy import select

    from wombat_api.database.models import Content

    # Soft-delete TC-PAY-1
    q = select(Content).where(Content.wombat_id == "TC-PAY-1")
    row = (await db_session.execute(q)).scalar_one()
    row.deleted_at = datetime.now(UTC)
    await db_session.flush()

    body = _plan_body(tags_any=["payments"])
    out = await ResolveService(repo).resolve_plan(project.id, body)
    wids = {c.wombat_id for c in out.cases}
    assert "TC-PAY-1" not in wids, "deleted rows must be excluded from filter results"
    assert "TC-PAY-2" in wids, "non-deleted payments case must still appear"


async def test_depth_5_suite_hierarchy_resolves_all_cases(repo, project, db_session):
    """A 5-level suite hierarchy resolves all descendant cases correctly.

    Structure:
      SUITE-D1 (root) — no cases
        SUITE-D2 — TC-DEPTH-2
          SUITE-D3 — TC-DEPTH-3
            SUITE-D4 — TC-DEPTH-4
              SUITE-D5 — TC-DEPTH-5

    resolve_suite("SUITE-D1") must return all four testcases.
    """
    for i in range(2, 6):
        await _make_testcase(db_session, project, f"TC-DEPTH-{i}")

    # Build hierarchy bottom-up so parent refs already exist.
    await _make_suite(db_session, project, "SUITE-D5", cases=["TC-DEPTH-5"])
    await _make_suite(db_session, project, "SUITE-D4", cases=["TC-DEPTH-4"], parent="SUITE-D3")
    await _make_suite(db_session, project, "SUITE-D3", cases=["TC-DEPTH-3"], parent="SUITE-D2")
    await _make_suite(db_session, project, "SUITE-D2", cases=["TC-DEPTH-2"], parent="SUITE-D1")

    # Update SUITE-D5 to set parent to SUITE-D4.
    from sqlalchemy import select

    d5_q = select(Content).where(Content.wombat_id == "SUITE-D5")
    d5_row = (await db_session.execute(d5_q)).scalar_one()
    d5_body = dict(d5_row.body)
    d5_body["parent_wombat_id"] = "SUITE-D4"
    d5_row.body = d5_body
    await db_session.flush()

    # Root suite (no parent, no cases of its own).
    await _make_suite(db_session, project, "SUITE-D1", cases=[])

    out = await ResolveService(repo).resolve_suite(project.id, "SUITE-D1")
    wids = {c.wombat_id for c in out.cases}
    for i in range(2, 6):
        assert f"TC-DEPTH-{i}" in wids, f"TC-DEPTH-{i} must be resolved in 5-level hierarchy"
    assert out.count == 4


async def test_determinism_across_multiple_calls(repo, project, seed):
    """resolve_plan called N times with the same body returns the same case order each time.

    Extends the existing determinism test by running 5 calls and comparing all.
    """
    body = _plan_body(tags_any=["payments"])
    svc = ResolveService(repo)
    results = [await svc.resolve_plan(project.id, body) for _ in range(5)]
    wid_lists = [[c.wombat_id for c in r.cases] for r in results]
    # All five calls must return the same ordered list.
    for i, wids in enumerate(wid_lists[1:], start=1):
        assert wids == wid_lists[0], f"Call {i+1} produced a different order: {wids} vs {wid_lists[0]}"


async def test_empty_plan_body_is_empty_no_crash(repo, project, seed):
    """An entirely empty plan body (missing keys) resolves to [] without raising.

    The service must treat missing keys as empty/absent, not crash on KeyError.
    """
    # {} has no 'include', 'exclude', 'suite_refs', 'explicit_cases' keys.
    body = {}
    out = await ResolveService(repo).resolve_plan(project.id, body)
    assert out.cases == []
    assert out.count == 0
    assert out.warnings == []
