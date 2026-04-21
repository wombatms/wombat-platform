"""Pydantic schemas for proposal routes."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ProposalCreate(BaseModel):
    kind: Literal["testcase", "shared_step", "story"]
    content_id: UUID | None = None
    source_path: str
    base_revision: str
    proposed_title: str
    proposed_body: dict
    proposal_action: Literal["upsert", "delete"] = "upsert"
    summary: str | None = None


class ProposalUpdate(BaseModel):
    proposed_title: str | None = None
    proposed_body: dict | None = None
    summary: str | None = None
    base_revision: str


class ProposalAction(BaseModel):
    comment: str | None = None


class ProposalEventResponse(BaseModel):
    id: UUID
    action: str
    user_id: UUID
    comment: str | None
    detail: dict | None
    created_at: datetime


class ProposalResponse(BaseModel):
    id: UUID
    project_id: UUID
    content_id: UUID | None
    kind: str
    source_path: str
    base_revision: str
    proposed_title: str
    proposed_body: dict
    proposal_action: str
    summary: str | None
    author_user_id: UUID
    author_kind: str
    status: str
    published_sha: str | None
    created_at: datetime
    updated_at: datetime


class ProposalDetailResponse(BaseModel):
    proposal: ProposalResponse
    before: dict | None  # current Content body or None for new-file proposals
    after: dict  # == proposal.proposed_body
    events: list[ProposalEventResponse]


class ProposalSummaryResponse(BaseModel):
    id: UUID
    kind: str
    source_path: str
    proposed_title: str
    author_user_id: UUID
    author_kind: str
    status: str
    created_at: datetime
    # change-size hint computed server-side
    change_added: int = Field(default=0)
    change_removed: int = Field(default=0)
