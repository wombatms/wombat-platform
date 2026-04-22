"""Pydantic request/response schemas for the SP3.3 Execution tier.

All DTOs covering:
  - Environments (§5.1)
  - Runs lifecycle (§5.2)
  - Results (§5.3)
  - Evidence (§5.4)
  - Events (§5.5)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Shared sub-objects
# ---------------------------------------------------------------------------


class RunCounts(BaseModel):
    """Status breakdown for a run's cases."""

    total: int = 0
    pass_: int = Field(0, alias="pass")
    fail: int = 0
    blocked: int = 0
    skipped: int = 0
    not_run: int = 0

    model_config = {"populate_by_name": True, "from_attributes": True}


class ActorRef(BaseModel):
    """Identifies a human user or API token as the actor for an event/result."""

    principal_type: Literal["user", "token"]
    id: UUID
    display_name: str | None = None

    model_config = {"from_attributes": True}


class AssigneeRef(BaseModel):
    """Identifies a run assignee (user or token)."""

    principal_type: Literal["user", "token"]
    id: UUID
    display_name: str | None = None

    model_config = {"from_attributes": True}


class BugLink(BaseModel):
    """A free-text bug/issue URL with optional title and note."""

    url: str
    title: str | None = None
    note: str | None = None


# ---------------------------------------------------------------------------
# Environment DTOs
# ---------------------------------------------------------------------------


class EnvironmentCreate(BaseModel):
    name: str


class EnvironmentOut(BaseModel):
    id: UUID
    name: str
    created_by: UUID | None = None
    created_at: datetime
    run_count: int | None = None  # optional; omitted on detail views

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Case selection (used on run create and rerun)
# ---------------------------------------------------------------------------


class CaseSelection(BaseModel):
    """Exactly one of `filter` or `case_ids` must be provided."""

    filter: dict[str, Any] | None = None  # noqa: A003 — same shape as Library filter
    case_ids: list[str] | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> CaseSelection:
        has_filter = bool(self.filter)
        has_ids = bool(self.case_ids)
        if has_filter == has_ids:
            raise ValueError("Provide exactly one of 'filter' or 'case_ids'.")
        return self


# ---------------------------------------------------------------------------
# Run request DTOs
# ---------------------------------------------------------------------------


class CreateRunRequest(BaseModel):
    title: str
    environment_id: UUID | None = None
    assignee_user_ids: list[UUID] = []
    assignee_token_ids: list[UUID] = []
    source: str = "manual"
    case_selection: CaseSelection


class PatchRunRequest(BaseModel):
    """Partial update while the run is open."""

    title: str | None = None
    environment_id: UUID | None = None
    assignee_user_ids: list[UUID] | None = None
    assignee_token_ids: list[UUID] | None = None


class AddCasesRequest(BaseModel):
    """Add cases to an existing open run."""

    case_selection: CaseSelection


class CloseRunRequest(BaseModel):
    reason: Literal["completed", "aborted"]
    note: str | None = None


class RerunRequest(BaseModel):
    """Spawn a new run from a subset of an existing run's cases."""

    include_statuses: list[str] | None = None
    case_ids: list[str] | None = None


# ---------------------------------------------------------------------------
# Run response DTOs
# ---------------------------------------------------------------------------


class RunOut(BaseModel):
    """List-item shape for a Run."""

    id: UUID
    title: str
    status: str  # open | completed | aborted
    environment_id: UUID | None = None
    environment_name: str | None = None
    owner_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    counts: RunCounts
    source: str
    parent_run_id: UUID | None = None

    model_config = {"from_attributes": True}


class RunDetailOut(BaseModel):
    """Full detail shape — includes fields not in the list view."""

    id: UUID
    title: str
    status: str
    environment_id: UUID | None = None
    environment_name: str | None = None
    owner_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    closed_at: datetime | None = None
    closure_note: str | None = None
    counts: RunCounts
    source: str
    parent_run_id: UUID | None = None
    assignees: list[AssigneeRef] = []

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Result request/response DTOs
# ---------------------------------------------------------------------------


class RecordResultItem(BaseModel):
    """Single item in a batch result ingestion request."""

    case_id: str  # wombat_id of the run case
    status: Literal["pass", "fail", "blocked", "skipped"]
    notes: str | None = None
    failed_at_step: int | None = None
    bug_links: list[BugLink] = []
    duration_ms: int | None = None
    if_match_revision: int | None = None


class RecordResultBatchRequest(BaseModel):
    """Batch result ingestion body — wraps a list of items."""

    results: list[RecordResultItem]


class RecordResultBatchResponseItem(BaseModel):
    """Per-item outcome from a batch result ingestion."""

    case_id: str
    ok: bool
    revision: int | None = None
    error: dict[str, Any] | None = None


class RecordResultBatchResponse(BaseModel):
    results: list[RecordResultBatchResponseItem]


class PutResultRequest(BaseModel):
    """Single-item result update (PUT); caller supplies If-Match header separately."""

    status: Literal["pass", "fail", "blocked", "skipped"]
    notes: str | None = None
    failed_at_step: int | None = None
    bug_links: list[BugLink] = []
    duration_ms: int | None = None


class ResultOut(BaseModel):
    id: UUID
    run_case_id: UUID
    case_id: str  # wombat_id
    status: str
    revision: int
    notes: str | None = None
    failed_at_step: int | None = None
    bug_links: list[dict[str, Any]] = []
    duration_ms: int | None = None
    recorded_by: ActorRef | None = None
    source: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Run-case response DTO
# ---------------------------------------------------------------------------


class RunCaseOut(BaseModel):
    run_case_id: UUID
    wombat_id: str
    title: str
    priority: str | None = None
    display_order: int
    snapshot_content_hash: str
    current_content_hash: str | None = None
    drifted: bool = False
    result: ResultOut | None = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Evidence DTOs
# ---------------------------------------------------------------------------


class EvidenceOut(BaseModel):
    id: UUID
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_by: ActorRef | None = None
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class EvidencePresignResponse(BaseModel):
    url: str
    expires_at: datetime


# ---------------------------------------------------------------------------
# Event DTO
# ---------------------------------------------------------------------------


class EventOut(BaseModel):
    id: UUID
    event_type: str
    actor: ActorRef | None = None
    payload: dict[str, Any] = {}
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Cursor-paginated events response
# ---------------------------------------------------------------------------


class EventsPage(BaseModel):
    data: list[EventOut]
    next_cursor: str | None = None
