"""sp3.2: proposals + proposal_events + api_tokens grant

Adds the proposal staging area (proposals + proposal_events) and the two
per-token grant columns (publish_direct + purpose) on api_tokens that
unlock the write path introduced by sub-project 3.2.

The partial unique index `ux_proposal_open_per_content` enforces "at most
one OPEN proposal per content row" at the database level on Postgres.
SQLAlchemy cannot express a `WHERE` clause on an Index portably, so the
index is created via raw SQL here.  SQLite-backed unit tests fall back to
a Python-side SELECT check in `Repository.create_proposal`.

Revision ID: 003_sp3_2_proposals
Revises: 002_tags_jsonb
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003_sp3_2_proposals"
down_revision: str | None = "002_tags_jsonb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- proposals ----
    op.create_table(
        "proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("base_revision", sa.String(), nullable=False),
        sa.Column("proposed_title", sa.String(), nullable=False),
        sa.Column(
            "proposed_body",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "proposal_action",
            sa.String(),
            nullable=False,
            server_default=sa.text("'upsert'"),
        ),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_kind", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default=sa.text("'open'"),
        ),
        sa.Column("published_sha", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["content_id"], ["content.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_proposal_project_status",
        "proposals",
        ["project_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_proposal_content",
        "proposals",
        ["content_id"],
        unique=False,
    )

    # Partial unique index: at most one OPEN proposal per content_id.
    # Postgres-only; SQLite tests tolerate duplicates (see repository).
    op.execute(
        "CREATE UNIQUE INDEX ux_proposal_open_per_content "
        "ON proposals (content_id) "
        "WHERE status = 'open' AND content_id IS NOT NULL"
    )

    # ---- proposal_events ----
    op.create_table(
        "proposal_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("proposal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("comment", sa.String(), nullable=True),
        sa.Column(
            "detail",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["proposals.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_proposal_event_proposal",
        "proposal_events",
        ["proposal_id", "created_at"],
        unique=False,
    )

    # ---- api_tokens grant columns ----
    op.add_column(
        "api_tokens",
        sa.Column(
            "publish_direct",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "api_tokens",
        sa.Column("purpose", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("api_tokens", "purpose")
    op.drop_column("api_tokens", "publish_direct")

    op.drop_index("ix_proposal_event_proposal", table_name="proposal_events")
    op.drop_table("proposal_events")

    op.execute("DROP INDEX IF EXISTS ux_proposal_open_per_content")
    op.drop_index("ix_proposal_content", table_name="proposals")
    op.drop_index("ix_proposal_project_status", table_name="proposals")
    op.drop_table("proposals")
