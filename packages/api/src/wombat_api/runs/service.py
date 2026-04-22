"""RunService — orchestrates the write path for the Execution tier.

The service layer is the single source of truth for business rules:
  - Snapshot-on-create (shared-step inlining + SHA-256 deduplication)
  - Batch result ingestion with per-case If-Match semantics
  - Run lifecycle: close / reopen / rerun

Routes call these methods; they must NOT bypass the service to hit the
repository directly for any mutating operation.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Literal

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.models import Content, RunCaseDB, RunDB
from wombat_api.database.repository import Repository
from wombat_api.runs.exceptions import RunClosedError, RunNotOpenError, ResultConflictError
from wombat_api.runs.schemas import (
    CaseSelection,
    RecordResultBatchResponseItem,
    RecordResultItem,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _canonical_json(body: dict) -> str:
    """Serialise a dict to JSON with sorted keys and no extra whitespace."""
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def _resolve_and_hash(
    content: Content,
    session: AsyncSession,
) -> tuple[dict, str]:
    """Expand shared-step references inline and compute a content hash.

    The resolved body is what gets frozen into ``run_case_snapshots``.  After
    this call, edits to shared_step rows (or to the testcase body) will NOT
    affect the frozen snapshot — that is the core audit-integrity guarantee.

    Current implementation:
      - Inspect ``content.body`` for a ``frontmatter.shared_steps`` list.
      - For each referenced wombat_id, look up the shared_step Content row in
        the *same project*.
      - Append the shared step's steps list to a copy of the resolved body
        under ``inlined_shared_steps``.
      - Hash the canonical JSON of the fully-resolved body.

    If a referenced shared_step cannot be found (deleted or never synced) we
    skip it silently — the snapshot still captures the body as-is so the run
    is not blocked.
    """
    body = content.body
    # Attempt to resolve shared-step references if the content kind is testcase
    # and the body contains shared_steps references.
    frontmatter = body.get("frontmatter", {}) if isinstance(body, dict) else {}
    shared_step_ids: list[str] = frontmatter.get("shared_steps", [])

    if shared_step_ids and content.kind == "testcase":
        from sqlalchemy import and_, select

        resolved_shared: list[dict] = []
        for ss_id in shared_step_ids:
            q = select(Content).where(
                and_(
                    Content.project_id == content.project_id,
                    Content.kind == "shared_step",
                    Content.wombat_id == ss_id,
                    Content.deleted_at.is_(None),
                )
            )
            ss_row = (await session.execute(q)).scalar_one_or_none()
            if ss_row is not None:
                resolved_shared.append(
                    {
                        "wombat_id": ss_id,
                        "title": ss_row.title,
                        "body": ss_row.body,
                    }
                )
        if resolved_shared:
            # Build a new resolved body that includes inlined shared steps.
            resolved_body: dict = dict(body)
            resolved_body["inlined_shared_steps"] = resolved_shared
        else:
            resolved_body = body
    else:
        resolved_body = body

    content_hash = _sha256(_canonical_json(resolved_body))
    return resolved_body, content_hash


# ---------------------------------------------------------------------------
# RunService
# ---------------------------------------------------------------------------


class RunService:
    """Orchestrates run lifecycle: create, record, close, reopen, rerun."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- Case selection -------------------------------------------------------

    async def _resolve_case_selection(
        self,
        project_id: uuid.UUID,
        case_selection: CaseSelection,
    ) -> list[Content]:
        """Resolve a CaseSelection to an ordered list of Content rows.

        - ``case_ids`` (list[str]): look up each wombat_id in the testcase
          table; preserve the caller's ordering; skip unknown wombat_ids.
        - ``filter`` (dict): delegate to ``repo.list_content`` with the filter
          expanded as a plain keyword-based search (q_text + kind=testcase).
          The filter dict supports ``{"q": "...", "tags": [...]}`` keys that
          map to ``list_content`` params.  More sophisticated filter expansion
          (tag containment, full-text) is supported by the repository; the
          service maps the shape here.
        """
        repo = Repository(self.session)

        if case_selection.case_ids is not None:
            # Ordered lookup by wombat_id.
            result: list[Content] = []
            for wid in case_selection.case_ids:
                row = await repo.get_content_by_wombat_id(
                    project_id=project_id,
                    kind="testcase",
                    wombat_id=wid,
                )
                if row is not None:
                    result.append(row)
            return result

        # Filter-based expansion.
        f = case_selection.filter or {}
        q_text: str | None = f.get("q")
        tags: list[str] | None = f.get("tags")
        limit: int = int(f.get("limit", 500))
        rows, _total = await repo.list_content(
            project_id=project_id,
            kind="testcase",
            tags=tags,
            q_text=q_text,
            limit=limit,
        )
        return rows

    # --- create_run -----------------------------------------------------------

    async def create_run(
        self,
        *,
        project_id: uuid.UUID,
        owner_id: uuid.UUID,
        title: str,
        case_selection: CaseSelection,
        environment_id: uuid.UUID | None = None,
        source: str = "manual",
        parent_run_id: uuid.UUID | None = None,
    ) -> RunDB:
        """Create a new run with frozen snapshots for all selected cases.

        Steps:
        1. Resolve ``case_selection`` → ordered list of Content rows.
        2. For each content row, resolve shared-step references inline and
           compute a SHA-256 content hash of the fully-resolved body.
        3. Upsert a ``RunCaseSnapshotDB`` row (deduped by hash).
        4. Insert the ``RunDB`` row.
        5. Insert ``RunCaseDB`` rows (one per selected case) in selection order.
        6. Append ``run_created`` event (with title + case_count in payload).
        7. Append ``case_added`` events — one per case added at creation time.
        8. Return the ``RunDB``.
        """
        repo = Repository(self.session)

        # Step 1: resolve selection
        cases = await self._resolve_case_selection(project_id, case_selection)

        # Step 2+3: snapshot each case
        snapshots = []
        for content in cases:
            resolved_body, content_hash = await _resolve_and_hash(content, self.session)
            snap = await repo.upsert_run_case_snapshot(
                content=content,
                resolved_body=resolved_body,
                content_hash=content_hash,
            )
            snapshots.append(snap)

        # Step 4: create the run
        run = await repo.create_run(
            project_id=project_id,
            title=title,
            owner_id=owner_id,
            environment_id=environment_id,
            source=source,
            parent_run_id=parent_run_id,
        )

        # Step 5: insert run_cases in selection order
        for display_order, snap in enumerate(snapshots):
            await repo.add_run_case(
                run_id=run.id,
                snapshot_id=snap.id,
                display_order=display_order,
                added_by_user_id=owner_id,
            )

        # Step 6: run_created event
        await repo.append_event(
            run_id=run.id,
            event_type="run_created",
            payload={"title": title, "case_count": len(cases)},
            actor_user_id=owner_id,
        )

        # Step 7: case_added events (one per case)
        for snap in snapshots:
            await repo.append_event(
                run_id=run.id,
                event_type="case_added",
                payload={
                    "case_id": snap.snapshot_wombat_id,
                    "snapshot_hash": snap.content_hash,
                },
                actor_user_id=owner_id,
            )

        return run

    # --- record_result_batch --------------------------------------------------

    async def record_result_batch(
        self,
        *,
        run: RunDB,
        items: list[RecordResultItem],
        actor_user_id: uuid.UUID | None,
        actor_token_id: uuid.UUID | None,
        source: str,
    ) -> list[RecordResultBatchResponseItem]:
        """Record results for multiple cases in one non-atomic batch.

        Batch semantics:
          - A closed run → raise RunClosedError (entire batch rejected before
            any item is processed).
          - Each item is processed independently; failures do not block the
            remaining items.
          - Missing case → ok=False, error.code="case_not_in_run".
          - ResultConflictError → ok=False, error.code="result_conflict",
            current_revision in the error payload.
          - On success, append result_recorded (revision==1) or result_updated.
          - After all items, if ``run.started_at is None``, stamp it to now.
        """
        if run.status != "open":
            raise RunClosedError()

        repo = Repository(self.session)
        out: list[RecordResultBatchResponseItem] = []

        # Cache run_case lookups by wombat_id per call.
        pairs = await repo.list_run_cases_with_snapshots(run.id)
        cases: dict[str, RunCaseDB] = {snap.snapshot_wombat_id: rc for rc, snap in pairs}

        for item in items:
            rc = cases.get(item.case_id)
            if rc is None:
                out.append(
                    RecordResultBatchResponseItem(
                        case_id=item.case_id,
                        ok=False,
                        error={"code": "case_not_in_run"},
                    )
                )
                continue

            try:
                result = await repo.upsert_result(
                    run_id=run.id,
                    run_case_id=rc.id,
                    status=item.status,
                    source=source,
                    recorded_by_user_id=actor_user_id,
                    recorded_by_token_id=actor_token_id,
                    notes=item.notes,
                    failed_at_step=item.failed_at_step,
                    bug_links=[bl.model_dump() for bl in item.bug_links] if item.bug_links else [],
                    duration_ms=item.duration_ms,
                    expected_revision=item.if_match_revision,
                )
                event_type = "result_recorded" if result.revision == 1 else "result_updated"
                await repo.append_event(
                    run_id=run.id,
                    event_type=event_type,
                    payload={
                        "case_id": item.case_id,
                        "status": item.status,
                        "revision": result.revision,
                    },
                    actor_user_id=actor_user_id,
                    actor_token_id=actor_token_id,
                )
                out.append(
                    RecordResultBatchResponseItem(
                        case_id=item.case_id,
                        ok=True,
                        revision=result.revision,
                    )
                )
            except ResultConflictError as exc:
                out.append(
                    RecordResultBatchResponseItem(
                        case_id=item.case_id,
                        ok=False,
                        error={
                            "code": "result_conflict",
                            "current_revision": exc.current_revision,
                        },
                    )
                )

        # Stamp started_at if this is the first result batch.
        await self.session.execute(
            update(RunDB)
            .where(RunDB.id == run.id, RunDB.started_at.is_(None))
            .values(started_at=func.now())
        )

        return out

    # --- close_run -----------------------------------------------------------

    async def close_run(
        self,
        run: RunDB,
        reason: Literal["completed", "aborted"],
        note: str | None,
        actor_user_id: uuid.UUID | None,
        actor_token_id: uuid.UUID | None,
    ) -> RunDB:
        """Close an open run with a given reason.

        Sets ``status`` and ``closed_at`` via the repository.  Appends
        ``run_closed`` (for "completed") or ``run_aborted`` (for "aborted").
        """
        repo = Repository(self.session)
        await repo.update_run_status(
            run_id=run.id,
            new_status=reason,
            note=note,
        )
        # Refresh the in-memory object.
        await self.session.refresh(run)

        event_type = "run_closed" if reason == "completed" else "run_aborted"
        await repo.append_event(
            run_id=run.id,
            event_type=event_type,
            payload={"reason": reason, "note": note},
            actor_user_id=actor_user_id,
            actor_token_id=actor_token_id,
        )
        return run

    # --- reopen_run ----------------------------------------------------------

    async def reopen_run(
        self,
        run: RunDB,
        actor_user_id: uuid.UUID | None,
        actor_token_id: uuid.UUID | None,
    ) -> RunDB:
        """Reopen a closed run.

        Requires ``run.status != "open"``.  Resets status to "open" and clears
        ``closed_at``.  Appends ``run_reopened`` event.
        """
        if run.status == "open":
            raise RunNotOpenError("Run is already open.")

        run.status = "open"
        run.closed_at = None  # type: ignore[assignment]
        await self.session.flush()

        repo = Repository(self.session)
        await repo.append_event(
            run_id=run.id,
            event_type="run_reopened",
            payload={},
            actor_user_id=actor_user_id,
            actor_token_id=actor_token_id,
        )
        return run

    # --- rerun ---------------------------------------------------------------

    async def rerun(
        self,
        parent_run: RunDB,
        owner_id: uuid.UUID,
        *,
        case_ids: list[str] | None = None,
        include_statuses: set[str] | None = None,
        environment_id: uuid.UUID | None = None,
        source: str = "manual",
    ) -> RunDB:
        """Create a new run derived from a parent run.

        Selection logic (in priority order):
          1. If ``case_ids`` is provided, use those wombat_ids directly.
          2. Otherwise filter parent run_cases to those whose *latest result*
             status is in ``include_statuses`` (default: {"fail", "blocked"}).

        A new run is created via ``create_run`` with ``parent_run_id`` set to
        the parent.  Snapshots are re-resolved from current content (not
        copied from the parent) so any interim content edits are captured in
        the new run.
        """
        if include_statuses is None:
            include_statuses = {"fail", "blocked"}

        repo = Repository(self.session)

        if case_ids is not None:
            selected_ids = case_ids
        else:
            # Get parent results and filter by status.
            results = await repo.list_results(run_id=parent_run.id)
            result_by_case_id: dict[uuid.UUID, str] = {
                r.run_case_id: r.status for r in results
            }
            pairs = await repo.list_run_cases_with_snapshots(parent_run.id)
            selected_ids = [
                snap.snapshot_wombat_id
                for rc, snap in pairs
                if result_by_case_id.get(rc.id) in include_statuses
            ]

        # Use case_ids if we have any; otherwise use a "no results" filter
        # (an empty case_ids list fails the CaseSelection validator, so we
        # route through the filter path with a highly-restrictive q that
        # returns no rows — keeping a consistent code path while still
        # allowing empty reruns).
        if selected_ids:
            selection = CaseSelection(case_ids=selected_ids)
        else:
            # Produce an empty run: use filter with a sentinel that matches nothing.
            # Alternatively, we bypass create_run entirely for the zero-case path.
            selection = None  # handled below

        repo = Repository(self.session)

        if selection is not None:
            new_run = await self.create_run(
                project_id=parent_run.project_id,
                owner_id=owner_id,
                title=f"Rerun: {parent_run.title}",
                case_selection=selection,
                environment_id=environment_id or parent_run.environment_id,
                source=source,
                parent_run_id=parent_run.id,
            )
        else:
            # Zero cases — create the run directly and emit run_created only.
            new_run = await repo.create_run(
                project_id=parent_run.project_id,
                title=f"Rerun: {parent_run.title}",
                owner_id=owner_id,
                environment_id=environment_id or parent_run.environment_id,
                source=source,
                parent_run_id=parent_run.id,
            )
            await repo.append_event(
                run_id=new_run.id,
                event_type="run_created",
                payload={"title": new_run.title, "case_count": 0},
                actor_user_id=owner_id,
            )

        return new_run

    async def rerun_failed(
        self,
        parent_run: RunDB,
        owner_id: uuid.UUID,
        *,
        environment_id: uuid.UUID | None = None,
        source: str = "manual",
    ) -> RunDB:
        """Convenience: rerun only cases with status in {fail, blocked}."""
        return await self.rerun(
            parent_run,
            owner_id,
            include_statuses={"fail", "blocked"},
            environment_id=environment_id,
            source=source,
        )
