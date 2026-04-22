"""Request/response schema types for the API."""

from __future__ import annotations

import uuid

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
