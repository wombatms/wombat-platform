"""ResolveService — plan and suite resolution logic.

Design choices documented here for the record:

- ``DepthLimitError`` lives in this module (not a shared errors file) because
  it is only raised by ResolveService and tests that import ResolveService
  already import this module.  Co-location follows the pattern established by
  OpenProposalExistsError / ProposalNotFoundError in repository.py.

- ``_match_filter`` is dialect-aware: on Postgres it issues a SQL query that
  filters on the ``tags`` JSONB column (``@>`` containment) and ``body``
  JSON fields (``body->>'priority'``, ``body->>'component'``).  On SQLite
  (unit tests) the same function loads all project testcases and applies
  equivalent Python-side predicates — exactly the same pattern used by
  ``list_suite_subtree`` and ``list_content``.

- add/remove/exclude composition order (spec §4.4):
    1. Start with filter_set (source="filter").
    2. Layer suite_set without overwriting existing source labels.
    3. Layer explicit_add without overwriting existing source labels.
    4. Subtract: remove ``exclude_set | explicit_remove`` from the map.

  Edge case the spec is silent on: a wombat_id that appears in both
  ``explicit_cases.add`` AND ``explicit_cases.remove``.  Choice: ``remove``
  wins (we subtract after the full union is built), so the case is excluded.
  This matches the spirit of "explicit remove" being a hard opt-out.

- Title lookup uses ``repo.get_content_by_wombat_ids``.  Cases that remain
  in the source map but have no live content row (i.e. the id came from
  ``explicit_cases.add`` for a truly missing case) are silently dropped from
  the final case list (the corresponding UNKNOWN_CASE_ID warning is already
  emitted at composition time).

- ``resolve_suite`` returns a ResolvedSuite where every case's source label
  is ``"suite_ref:{root_wombat_id}"`` — i.e. the root that was resolved, not
  the individual sub-suite that contributed the case.  This matches the spec
  shape and is adequate for the suite-detail page (which only shows one
  root's resolved cases at a time).

- ``_resolve_suite`` is an internal recursive helper that accumulates a
  ``set[str]`` of wombat_ids.  It calls ``repo.list_suite_subtree`` which
  returns the entire subtree in one DB round-trip (using a recursive CTE on
  Postgres, Python BFS on SQLite).  The depth limit is enforced inside
  ``list_suite_subtree``; ``_resolve_suite`` additionally raises
  ``DepthLimitError`` if ``depth`` exceeds 20 (defensive guard for direct
  callers).
"""

from __future__ import annotations

import uuid


class DepthLimitError(Exception):
    """Raised when suite resolution exceeds the maximum allowed depth (20)."""

    def __init__(self, wombat_id: str) -> None:
        self.wombat_id = wombat_id
        super().__init__(f"suite depth limit exceeded at {wombat_id}")


class ResolveService:
    """Orchestrates plan and suite resolution against the project's content.

    Args:
        repo: A ``Repository`` instance bound to the current async session.
    """

    def __init__(self, repo) -> None:
        self.repo = repo

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def resolve_plan(self, project_id: uuid.UUID, plan_body: dict):
        """Resolve a plan body dict against live project content.

        Args:
            project_id: The project UUID to scope all queries.
            plan_body: A plan body dict (as stored in ``content.body`` or
                submitted in a draft-resolve request).

        Returns:
            A :class:`ResolvedPlan` with ``cases``, ``count``, and
            ``warnings``.
        """
        from wombat_api.planning.schemas import ResolvedCase, ResolvedPlan, ResolveWarning

        warnings: list[ResolveWarning] = []

        # ---- 1. Filter sets --------------------------------------------------
        include = plan_body.get("include") or {}
        exclude = plan_body.get("exclude") or {}
        filter_set: set[str] = await self._match_filter(project_id, include)
        exclude_set: set[str] = await self._match_filter(project_id, exclude)

        # ---- 2. Suite refs ---------------------------------------------------
        # sources map: wombat_id -> source label (first writer wins).
        sources: dict[str, str] = {wid: "filter" for wid in filter_set}

        for sref in plan_body.get("suite_refs") or []:
            sub_ids = await self._resolve_suite(project_id, sref, warnings)
            for wid in sub_ids:
                sources.setdefault(wid, f"suite_ref:{sref}")

        # ---- 3. Explicit add/remove ------------------------------------------
        ec = plan_body.get("explicit_cases") or {}
        add_ids: list[str] = list(ec.get("add") or [])
        remove_ids: set[str] = set(ec.get("remove") or [])

        # Validate explicit IDs against live content (warn on unknowns).
        all_explicit: set[str] = (set(add_ids) | remove_ids)
        if all_explicit:
            existing_rows = await self.repo.get_content_by_wombat_ids(
                project_id, list(all_explicit)
            )
            existing_ids: set[str] = {r.wombat_id for r in existing_rows if r.wombat_id}
            for wid in add_ids:
                if wid not in existing_ids:
                    warnings.append(ResolveWarning(code="UNKNOWN_CASE_ID", target=wid))
            for wid in sorted(remove_ids):  # sorted for determinism in warnings list
                if wid not in existing_ids:
                    warnings.append(ResolveWarning(code="UNKNOWN_CASE_ID", target=wid))

        # Layer in explicit_add (first-writer-wins: don't overwrite filter/suite label).
        for wid in add_ids:
            sources.setdefault(wid, "explicit_add")

        # ---- 4. Subtract exclusions ------------------------------------------
        for wid in exclude_set | remove_ids:
            sources.pop(wid, None)

        # ---- 5. Title lookup + build output ----------------------------------
        if sources:
            rows = await self.repo.get_content_by_wombat_ids(project_id, list(sources.keys()))
            title_by: dict[str, str] = {
                r.wombat_id: _extract_title(r) for r in rows if r.wombat_id
            }
        else:
            title_by = {}

        cases = sorted(
            (
                ResolvedCase(
                    wombat_id=wid,
                    title=title_by.get(wid, wid),
                    source=sources[wid],
                )
                for wid in sources
                if wid in title_by  # silently drop IDs with no live content row
            ),
            key=lambda c: c.wombat_id,
        )
        return ResolvedPlan(cases=cases, count=len(cases), warnings=warnings)

    async def resolve_suite(self, project_id: uuid.UUID, root_wombat_id: str):
        """Resolve the effective case set for a suite root (including subtree).

        Args:
            project_id: The project UUID.
            root_wombat_id: The wombat_id of the root suite.

        Returns:
            A :class:`ResolvedSuite` with ``cases``, ``count``, and
            ``warnings``.

        Raises:
            :class:`DepthLimitError`: if the subtree exceeds 20 levels.
        """
        from wombat_api.planning.schemas import ResolvedCase, ResolvedSuite, ResolveWarning

        warnings: list[ResolveWarning] = []
        ids: set[str] = await self._resolve_suite(project_id, root_wombat_id, warnings)

        rows = await self.repo.get_content_by_wombat_ids(project_id, list(ids))
        cases = sorted(
            (
                ResolvedCase(
                    wombat_id=r.wombat_id,
                    title=_extract_title(r),
                    source=f"suite_ref:{root_wombat_id}",
                )
                for r in rows
                if r.wombat_id
            ),
            key=lambda c: c.wombat_id,
        )
        return ResolvedSuite(cases=cases, count=len(cases), warnings=warnings)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _resolve_suite(
        self,
        project_id: uuid.UUID,
        root: str,
        warnings,
        visited: set[str] | None = None,
        depth: int = 0,
    ) -> set[str]:
        """Recursively collect all wombat_ids contributed by a suite subtree.

        Returns an empty set (plus an UNKNOWN_SUITE_REF warning) if the root
        suite does not exist.  Raises :class:`DepthLimitError` if ``depth``
        exceeds 20 — a defensive guard on top of the DB-level depth_limit
        enforced by ``list_suite_subtree``.

        Cycle detection is primarily enforced at write time (linter rules
        SUITE_CYCLE / SUITE_SELF_PARENT).  Here we track ``visited`` to
        avoid infinite loops at resolve time in the event a stale cycle
        somehow reaches the DB.
        """
        from wombat_api.planning.schemas import ResolveWarning

        if depth > 20:
            raise DepthLimitError(root)

        visited = set() if visited is None else visited
        if root in visited:
            # Cycle guard — should never happen on clean data; warn and bail.
            return set()
        visited = visited | {root}

        subtree = await self.repo.list_suite_subtree(project_id, root)
        if not subtree:
            warnings.append(ResolveWarning(code="UNKNOWN_SUITE_REF", target=root))
            return set()

        out: set[str] = set()
        for suite_row in subtree:
            body = suite_row.body or {}
            # Explicit cases listed directly on the suite.
            out.update(body.get("cases") or [])
            # Filter-matched cases from the suite's own include filter.
            inc = body.get("include") or {}
            out.update(await self._match_filter(project_id, inc))

        return out

    async def _match_filter(self, project_id: uuid.UUID, filt: dict) -> set[str]:
        """Return wombat_ids of kind='testcase' rows matching *filt*.

        Supports three filter keys (all optional; empty filter returns empty set):
        - ``tags_any``: list[str] — case must have at least one matching tag.
        - ``priorities``: list[str] — case priority must be in the list.
        - ``components_any``: list[str] — case component must be in the list.

        Empty or missing filter → empty set (not "all cases").  This is
        intentional: a plan with no include filter simply starts with an
        empty base and relies on suite_refs + explicit_cases.add for its
        cases.

        Dialect behaviour:
        - Postgres: single SQL query using JSONB ``@>`` for tags and JSON
          path operators for priority/component.
        - SQLite (unit tests): Python-side filtering over a pre-loaded
          result set — exact semantic equivalent, no JSONB operators.
        """
        tags_any: list[str] = filt.get("tags_any") or []
        priorities: list[str] = [str(p) for p in (filt.get("priorities") or [])]
        components_any: list[str] = filt.get("components_any") or []

        # Empty filter → empty set.
        if not tags_any and not priorities and not components_any:
            return set()

        from sqlalchemy import and_, select

        from wombat_api.database.models import Content

        _dialect = (
            self.repo.session.bind.dialect.name
            if self.repo.session.bind is not None
            else "postgresql"
        )

        if _dialect == "postgresql":
            return await self._match_filter_pg(
                project_id, tags_any, priorities, components_any
            )

        # SQLite fallback: load all project testcases and filter in Python.
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.kind == "testcase",
                Content.deleted_at.is_(None),
            )
        )
        rows = list((await self.repo.session.execute(q)).scalars())

        out: set[str] = set()
        for row in rows:
            if not row.wombat_id:
                continue
            body = row.body or {}
            if not _row_matches_filter(row, body, tags_any, priorities, components_any):
                continue
            out.add(row.wombat_id)
        return out

    async def _match_filter_pg(
        self,
        project_id: uuid.UUID,
        tags_any: list[str],
        priorities: list[str],
        components_any: list[str],
    ) -> set[str]:
        """Postgres-specific implementation of _match_filter."""
        from sqlalchemy import and_, or_, select, text

        from wombat_api.database.models import Content

        conds = [
            Content.project_id == project_id,
            Content.kind == "testcase",
            Content.deleted_at.is_(None),
        ]

        if tags_any:
            # Any of the listed tags must appear in the tags column.
            # tags column is JSONB (list of strings).  We build one
            # @> containment check per tag and OR them together so that
            # ANY match suffices.
            from sqlalchemy import bindparam
            from sqlalchemy.dialects.postgresql import JSONB as _JSONB

            tag_conds = []
            for i, t in enumerate(tags_any):
                param = bindparam(f"_ftag_{i}", value=[t], type_=_JSONB, unique=True)
                tag_conds.append(Content.tags.op("@>")(param))
            conds.append(or_(*tag_conds))

        if priorities:
            # body->>'priority' must be in the list.
            priority_conds = [
                text(f"content.body->>'priority' = :prio_{i}").bindparams(**{f"prio_{i}": p})
                for i, p in enumerate(priorities)
            ]
            conds.append(or_(*priority_conds))

        if components_any:
            # body->>'component' must be in the list.
            comp_conds = [
                text(f"content.body->>'component' = :comp_{i}").bindparams(**{f"comp_{i}": c})
                for i, c in enumerate(components_any)
            ]
            conds.append(or_(*comp_conds))

        q = select(Content.wombat_id).where(and_(*conds))
        result = await self.repo.session.execute(q)
        return {row[0] for row in result if row[0]}


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _extract_title(row) -> str:
    """Best-effort title extraction from a Content row."""
    if row.title:
        return row.title
    body = row.body or {}
    # Testcase bodies store fields at the top level (model_dump output).
    return body.get("title") or (row.wombat_id or "")


def _row_matches_filter(
    row,
    body: dict,
    tags_any: list[str],
    priorities: list[str],
    components_any: list[str],
) -> bool:
    """Python-side filter predicate (SQLite unit-test path).

    Mirrors the Postgres SQL logic: all non-empty criteria must match
    (AND between criteria groups, OR within each group).
    """
    if tags_any:
        # Content.tags is a list stored as JSON; body.tags is also available.
        row_tags: list[str] = list(row.tags or []) or list(body.get("tags") or [])
        if not any(t in row_tags for t in tags_any):
            return False

    if priorities:
        row_priority: str = body.get("priority") or ""
        if row_priority not in priorities:
            return False

    if components_any:
        row_component: str = body.get("component") or ""
        if row_component not in components_any:
            return False

    return True
