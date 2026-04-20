"""SQLAlchemy models: unified content table + operational tables."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from wombat_api.config import get_config
from wombat_api.database.engine import Base

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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class APITokenDB(Base):
    __tablename__ = "api_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UserProjectRoleDB(Base):
    __tablename__ = "user_project_roles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), primary_key=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String)  # viewer | editor | admin


# ---- Unified Content + Chunks ------------------------------------------------

class Content(Base):
    __tablename__ = "content"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String)  # testcase | shared_step | plan | story | suite | doc
    wombat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    body: Mapped[dict] = mapped_column(JSON)  # full parsed Pydantic entity

    # pgvector column; nullable because chunked docs keep embedding on children.
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(EMBED_DIM), nullable=True
    )

    source_repo: Mapped[str] = mapped_column(String)
    source_path: Mapped[str] = mapped_column(String)
    source_revision: Mapped[str] = mapped_column(String)
    content_hash: Mapped[str] = mapped_column(String)

    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    chunks: Mapped[list["ContentChunk"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("project_id", "kind", "wombat_id",
                         name="uq_content_kind_wid"),
        UniqueConstraint("project_id", "source_repo", "source_path",
                         name="uq_content_path"),
        Index("ix_content_project_kind", "project_id", "kind"),
        # Vector IVFFlat index declared in Alembic migration (Task 4) —
        # cannot express postgresql_ops + with params portably here.
        # Tag and FTS indexes also declared in the migration.
    )


class ContentChunk(Base):
    __tablename__ = "content_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    content_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String)
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(EMBED_DIM), nullable=True
    )

    parent: Mapped[Content] = relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("content_id", "chunk_index", name="uq_chunk_idx"),
    )


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
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuditLogDB(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str] = mapped_column(String)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interface: Mapped[str] = mapped_column(String)  # api | cli | mcp
    agent_type: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
