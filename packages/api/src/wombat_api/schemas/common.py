"""Request/response schema types for the API."""

from __future__ import annotations

import uuid
from datetime import datetime
from pydantic import BaseModel


class ProjectCreate(BaseModel):
    slug: str
    name: str
    org: str | None = None
    default_owner: str | None = None
    taxonomy_components: list[str] = []
    taxonomy_environments: list[str] = []


class UserCreate(BaseModel):
    email: str
    password: str
    display_name: str


class RunCreate(BaseModel):
    title: str
    plan_wombat_id: str | None = None
    environment: str | None = None
    assignees: list[str] = []
    source: str = "api"


class ExecutionResultCreate(BaseModel):
    testcase_id: str  # wombat_id
    match_by: str = "wombat_id"
    status: str  # pass | fail | block | skip | error
    duration_ms: int | None = None
    environment: str | None = None
    automated: bool = False
    notes: str | None = None
    bug_references: list[str] = []
    evidence_references: list[str] = []
    raw_payload: dict | None = None


class RunSummary(BaseModel):
    run_id: uuid.UUID
    total: int
    passed: int
    failed: int
    blocked: int
    skipped: int
    errored: int
    duration_ms: int | None = None


class SyncSummary(BaseModel):
    source_repo: str
    revision: str
    entities_created: int
    entities_updated: int
    entities_deleted: int
    entities_skipped: int
    errors: list[dict] = []
    duration_ms: int


class PaginationMeta(BaseModel):
    total: int
    limit: int
    offset: int
    has_more: bool


class ContentHit(BaseModel):
    id: uuid.UUID
    kind: str
    wombat_id: str | None
    title: str
    score: float
    snippet: str | None = None
    chunk_index: int | None = None
    source: dict  # {repo, path, revision}


class SearchResult(BaseModel):
    hits: list[ContentHit]
    total_considered: int
