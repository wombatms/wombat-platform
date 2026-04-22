"""SQLAlchemy models: unified content table + operational tables."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    column,
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
    # SP3.3 additions: explicit permission subset granted at token-issuance time.
    # NULL means "use role defaults"; an empty list means "no extra permissions";
    # a populated list is the exact set of runs:* (and other) permissions granted.
    permissions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)
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


# ---- Runs / Execution (SP3.3) ------------------------------------------------


class EnvironmentDB(Base):
    __tablename__ = "environments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        Index(
            "ux_environment_project_name",
            "project_id",
            "name",
            unique=True,
        ),
    )


class RunDB(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="open")
    # open | completed | aborted
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("environments.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String, default="manual")
    # manual | automated | ci | api | cli | mcp
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("runs.id"), nullable=True
    )
    # SP3.4 placeholder: nullable, no FK yet.
    plan_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closure_note: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_run_project_status_created", "project_id", "status", "created_at"),
    )


class RunAssigneeDB(Base):
    __tablename__ = "run_assignees"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    token_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("api_tokens.id"), nullable=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        # Exactly one of user_id/token_id is set.
        CheckConstraint(
            "(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) + "
            "(CASE WHEN token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_run_assignee_exactly_one_principal",
        ),
        # Unique per run on whichever principal type is populated.
        # Portable expression uniqueness: concat user_id/token_id with a tag
        # keeps human vs. token separate.
        Index(
            "ux_run_assignee_principal",
            "run_id",
            func.coalesce(
                func.cast(column("user_id"), String),
                func.concat("tok:", func.cast(column("token_id"), String)),
            ),
            unique=True,
        ),
    )


class RunCaseSnapshotDB(Base):
    __tablename__ = "run_case_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Dedup key: same body → same snapshot row, referenced by many run_cases.
    content_hash: Mapped[str] = mapped_column(String, unique=True)
    content_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("content.id"))
    # Fully-resolved body (shared-steps inlined) matching wombat_core body shape.
    snapshot_body: Mapped[dict] = mapped_column(_PortableJSONB)
    snapshot_title: Mapped[str] = mapped_column(String)
    # Display id as it appeared at snapshot time.
    snapshot_wombat_id: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class RunCaseDB(Base):
    __tablename__ = "run_cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE")
    )
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("run_case_snapshots.id")
    )
    display_order: Mapped[int] = mapped_column()
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        Index("ux_run_case_unique", "run_id", "snapshot_id", unique=True),
    )


class ResultDB(Base):
    __tablename__ = "results"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE")
    )
    run_case_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("run_cases.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String)
    # pass | fail | blocked | skipped
    failed_at_step: Mapped[int | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    bug_links: Mapped[list[dict]] = mapped_column(_PortableJSONB, default=list)
    duration_ms: Mapped[int | None] = mapped_column(nullable=True)
    recorded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    recorded_by_token_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("api_tokens.id"), nullable=True
    )
    source: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN recorded_by_user_id IS NOT NULL THEN 1 ELSE 0 END) + "
            "(CASE WHEN recorded_by_token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_result_exactly_one_recorder",
        ),
        Index("ux_result_unique_case", "run_id", "run_case_id", unique=True),
        Index("ix_result_run_status", "run_id", "status"),
    )


class ResultEvidenceDB(Base):
    __tablename__ = "result_evidence"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    result_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("results.id", ondelete="CASCADE")
    )
    # Opaque handle returned by the EvidenceBackend.
    blob_id: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column()
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    uploaded_by_token_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("api_tokens.id"), nullable=True
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN uploaded_by_user_id IS NOT NULL THEN 1 ELSE 0 END) + "
            "(CASE WHEN uploaded_by_token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_evidence_exactly_one_uploader",
        ),
    )


class RunEventDB(Base):
    __tablename__ = "run_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE")
    )
    event_type: Mapped[str] = mapped_column(String)
    # run_created | case_added | case_removed | result_recorded |
    # result_updated | evidence_attached | evidence_removed |
    # run_closed | run_aborted | run_reopened |
    # assignee_added | assignee_removed
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    actor_token_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("api_tokens.id"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(_PortableJSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("ix_run_event_run_created", "run_id", "created_at"),
    )
