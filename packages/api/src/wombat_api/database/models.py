"""SQLAlchemy models: unified content table + operational tables."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    types as sa_types,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from wombat_api.config import get_config
from wombat_api.database.engine import Base

# ---------------------------------------------------------------------------
# Portable JSONB type
# ---------------------------------------------------------------------------


class _PortableJSONB(sa_types.TypeDecorator):
    """JSONB on PostgreSQL; plain JSON on every other dialect (e.g. SQLite).

    Use this for columns that need @> containment-operator support on Postgres
    while remaining compatible with the SQLite-backed unit-test suite.
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


_cfg = get_config()
EMBED_DIM = _cfg.embed_dim  # resolved at import time; asserted at app startup


# ---- Projects / Users / RBAC -------------------------------------------------


class ProjectDB(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    org: Mapped[str | None] = mapped_column(String, nullable=True)
    default_owner: Mapped[str | None] = mapped_column(String, nullable=True)
    taxonomy_components: Mapped[list[str]] = mapped_column(JSON, default=list)
    taxonomy_environments: Mapped[list[str]] = mapped_column(JSON, default=list)
    # SP3.2: Git remote URL for the project's canonical test-content repository.
    # Used by the publisher to clone / push approved proposals.
    git_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserDB(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True)
    hashed_password: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class APITokenDB(Base):
    __tablename__ = "api_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SP3.2 additions
    publish_direct: Mapped[bool] = mapped_column(default=False)
    purpose: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserProjectRoleDB(Base):
    __tablename__ = "user_project_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String)  # viewer | editor | admin


# ---- Unified Content + Chunks ------------------------------------------------


class Content(Base):
    __tablename__ = "content"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String)  # testcase | shared_step | plan | story | suite | doc
    wombat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String)
    # JSONB/JSON policy: columns used for containment/GIN filtering (e.g.
    # `tags.op('@>')(...)`) must be JSONB so Postgres can compile the @>
    # containment operator.  Pure-store columns (body, errors, scopes, etc.)
    # stay as plain JSON — they are only serialised/deserialised, never filtered
    # with containment operators.
    # _PortableJSONB resolves to JSONB on Postgres, JSON on SQLite (unit tests).
    tags: Mapped[list[str]] = mapped_column(_PortableJSONB, default=list)
    body: Mapped[dict] = mapped_column(JSON)  # full parsed Pydantic entity

    # pgvector column; nullable because chunked docs keep embedding on children.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)

    source_repo: Mapped[str] = mapped_column(String)
    source_path: Mapped[str] = mapped_column(String)
    source_revision: Mapped[str] = mapped_column(String)
    content_hash: Mapped[str] = mapped_column(String)

    # SP3.2: set True when publisher writes a new file but reindex fails, so that
    # the background embedder knows to re-embed this row on its next pass.
    stale_embedding: Mapped[bool] = mapped_column(default=False)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    chunks: Mapped[list[ContentChunk]] = relationship(back_populates="parent", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("project_id", "kind", "wombat_id", name="uq_content_kind_wid"),
        UniqueConstraint("project_id", "source_repo", "source_path", name="uq_content_path"),
        Index("ix_content_project_kind", "project_id", "kind"),
        # Vector IVFFlat index declared in Alembic migration (Task 4) —
        # cannot express postgresql_ops + with params portably here.
        # Tag and FTS indexes also declared in the migration.
    )


class ContentChunk(Base):
    __tablename__ = "content_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("content.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM), nullable=True)

    parent: Mapped[Content] = relationship(back_populates="chunks")

    __table_args__ = (UniqueConstraint("content_id", "chunk_index", name="uq_chunk_idx"),)


# ---- Runs / Results ----------------------------------------------------------


class RunDB(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    plan_wombat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String)
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String)  # api | cli | mcp
    status: Mapped[str] = mapped_column(String, default="pending")
    assignees: Mapped[list[str]] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ExecutionResultDB(Base):
    __tablename__ = "execution_results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    # FK to the `content` row with kind='testcase' that this result is for.
    content_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("content.id"))
    wombat_testcase_id: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    environment: Mapped[str | None] = mapped_column(String, nullable=True)
    automated: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    bug_references: Mapped[list[str]] = mapped_column(JSON, default=list)
    evidence_references: Mapped[list[str]] = mapped_column(JSON, default=list)
    raw_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---- Logs --------------------------------------------------------------------


class SyncLogDB(Base):
    __tablename__ = "sync_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    source_repo: Mapped[str] = mapped_column(String)
    revision: Mapped[str] = mapped_column(String)
    entities_created: Mapped[int] = mapped_column(Integer, default=0)
    entities_updated: Mapped[int] = mapped_column(Integer, default=0)
    entities_deleted: Mapped[int] = mapped_column(Integer, default=0)
    entities_skipped: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list[dict]] = mapped_column(JSON, default=list)
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLogDB(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interface: Mapped[str] = mapped_column(String)  # api | cli | mcp
    agent_type: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---- Proposals (SP3.2) -------------------------------------------------------


class ProposalDB(Base):
    __tablename__ = "proposals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    # Nullable: new-file proposals have no existing content row yet.
    content_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("content.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String)  # testcase | shared_step | story
    source_path: Mapped[str] = mapped_column(String)
    base_revision: Mapped[str] = mapped_column(String)
    proposed_title: Mapped[str] = mapped_column(String)
    # Full body: {"frontmatter": {...}, "markdown": "..."} matching wombat_core.parsing.writer.
    proposed_body: Mapped[dict] = mapped_column(_PortableJSONB)
    proposal_action: Mapped[str] = mapped_column(String, default="upsert")  # upsert | delete
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    author_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    author_kind: Mapped[str] = mapped_column(String)  # human | agent
    status: Mapped[str] = mapped_column(String, default="open")
    # open | published | rejected | conflict | withdrawn
    published_sha: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_proposal_project_status", "project_id", "status"),
        Index("ix_proposal_content", "content_id"),
        # Partial unique index enforced by migration only — SQLAlchemy can't express
        # `WHERE status='open'` portably. The migration adds it for Postgres; SQLite
        # tests use a trigger-free loose contract (see repository.create_proposal).
    )


class ProposalEventDB(Base):
    __tablename__ = "proposal_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    proposal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String)
    # created | updated | approved | direct_published | rejected | withdrawn | conflict_detected
    comment: Mapped[str | None] = mapped_column(String, nullable=True)
    detail: Mapped[dict | None] = mapped_column(_PortableJSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_proposal_event_proposal", "proposal_id", "created_at"),)
