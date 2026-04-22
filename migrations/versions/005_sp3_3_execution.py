"""SP3.3 execution: drop SP2 runs, add 8 new tables.

Revision ID: 005_sp3_3_execution
Revises: 004_sp3_2_content_and_project
Create Date: 2026-04-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "005_sp3_3_execution"
down_revision = "004_sp3_2_content_and_project"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    # ---- 1. Drop SP2 runs scaffolding (forward-only) ----
    # Use IF EXISTS so that re-running after a downgrade (which did not
    # recreate these SP2 tables) succeeds idempotently.
    op.execute("DROP TABLE IF EXISTS execution_results")
    op.execute("DROP TABLE IF EXISTS runs")

    # ---- 2. environments ----
    op.create_table(
        "environments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "name", name="ux_environment_project_name"),
    )

    # ---- 3. runs ----
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column(
            "environment_id",
            sa.Uuid(),
            sa.ForeignKey("environments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source", sa.String(), nullable=False, server_default="manual"),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("parent_run_id", sa.Uuid(), sa.ForeignKey("runs.id"), nullable=True),
        sa.Column("plan_id", sa.Uuid(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closure_note", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_run_project_status_created",
        "runs",
        ["project_id", "status", "created_at"],
    )

    # ---- 4. run_assignees ----
    op.create_table(
        "run_assignees",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("token_id", sa.Uuid(), sa.ForeignKey("api_tokens.id"), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "added_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(user_id IS NOT NULL)::int + (token_id IS NOT NULL)::int = 1"
            if is_pg
            else "(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) + "
                 "(CASE WHEN token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_run_assignee_exactly_one_principal",
        ),
    )
    # Expression-based uniqueness: use a generated text column for portability.
    if is_pg:
        op.execute(
            "CREATE UNIQUE INDEX ux_run_assignee_principal ON run_assignees "
            "(run_id, COALESCE(user_id::text, 'tok:' || token_id::text))"
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX ux_run_assignee_principal ON run_assignees "
            "(run_id, COALESCE(user_id, 'tok:' || token_id))"
        )

    # ---- 5. run_case_snapshots ----
    op.create_table(
        "run_case_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("content_hash", sa.String(), nullable=False, unique=True),
        sa.Column("content_id", sa.Uuid(), sa.ForeignKey("content.id"), nullable=False),
        sa.Column(
            "snapshot_body",
            sa.dialects.postgresql.JSONB() if is_pg else sa.JSON(),
            nullable=False,
        ),
        sa.Column("snapshot_title", sa.String(), nullable=False),
        sa.Column("snapshot_wombat_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # ---- 6. run_cases ----
    op.create_table(
        "run_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "snapshot_id",
            sa.Uuid(),
            sa.ForeignKey("run_case_snapshots.id"),
            nullable=False,
        ),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "added_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.UniqueConstraint("run_id", "snapshot_id", name="ux_run_case_unique"),
    )

    # ---- 7. results ----
    op.create_table(
        "results",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_case_id",
            sa.Uuid(),
            sa.ForeignKey("run_cases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("failed_at_step", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column(
            "bug_links",
            sa.dialects.postgresql.JSONB() if is_pg else sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb") if is_pg else sa.text("'[]'"),
        ),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "recorded_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "recorded_by_token_id",
            sa.Uuid(),
            sa.ForeignKey("api_tokens.id"),
            nullable=True,
        ),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(recorded_by_user_id IS NOT NULL)::int "
            "+ (recorded_by_token_id IS NOT NULL)::int = 1"
            if is_pg
            else "(CASE WHEN recorded_by_user_id IS NOT NULL THEN 1 ELSE 0 END) + "
                 "(CASE WHEN recorded_by_token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_result_exactly_one_recorder",
        ),
        sa.UniqueConstraint("run_id", "run_case_id", name="ux_result_unique_case"),
    )
    op.create_index("ix_result_run_status", "results", ["run_id", "status"])

    # ---- 8. result_evidence ----
    op.create_table(
        "result_evidence",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "result_id",
            sa.Uuid(),
            sa.ForeignKey("results.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("blob_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "uploaded_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_by_token_id",
            sa.Uuid(),
            sa.ForeignKey("api_tokens.id"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(uploaded_by_user_id IS NOT NULL)::int "
            "+ (uploaded_by_token_id IS NOT NULL)::int = 1"
            if is_pg
            else "(CASE WHEN uploaded_by_user_id IS NOT NULL THEN 1 ELSE 0 END) + "
                 "(CASE WHEN uploaded_by_token_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_evidence_exactly_one_uploader",
        ),
    )

    # ---- 9. run_events ----
    op.create_table(
        "run_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column(
            "actor_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "actor_token_id",
            sa.Uuid(),
            sa.ForeignKey("api_tokens.id"),
            nullable=True,
        ),
        sa.Column(
            "payload",
            sa.dialects.postgresql.JSONB() if is_pg else sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb") if is_pg else sa.text("'{}'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_run_event_run_created", "run_events", ["run_id", "created_at"])

    # ---- 10. Seed default environment per existing project ----
    # Idempotent: INSERT ... ON CONFLICT DO NOTHING on the unique (project_id, name).
    op.execute(
        """
        INSERT INTO environments (id, project_id, name, created_by_user_id, created_at)
        SELECT gen_random_uuid() AS id,
               p.id                AS project_id,
               'default'           AS name,
               (SELECT id FROM users ORDER BY created_at ASC LIMIT 1) AS created_by_user_id,
               NOW()               AS created_at
        FROM projects p
        ON CONFLICT ON CONSTRAINT ux_environment_project_name DO NOTHING
        """
        if is_pg
        else "SELECT 1"
    )
    # On SQLite, test fixtures will seed environments explicitly.


def downgrade() -> None:
    for tbl in (
        "run_events",
        "result_evidence",
        "results",
        "run_cases",
        "run_case_snapshots",
        "run_assignees",
        "runs",
        "environments",
    ):
        op.drop_table(tbl)
    # Not restoring SP2 runs/execution_results — forward-only decision.
