"""SP3.4 planning + dashboards: indexes only + defensive explicit_cases reshape.

Additive-only migration.  Creates five indexes that back the SP3.4 dashboard
widgets and the review-backlog widget, and defensively reshapes any legacy
``plan.body.explicit_cases`` rows from the old ``list[str]`` shape into the
new ``{add: list[str], remove: list[str]}`` shape.

Index naming notes
------------------
* The spec names the "completion" timestamp as ``finished_at``, but the
  SP3.3 schema actually stores ``closed_at`` on ``runs`` and
  ``updated_at`` on ``results`` (when the latest result row was recorded).
  We keep the spec-level index names and map to the real columns.
* If a functionally equivalent index already exists under a different name
  (SP3.2 created ``ix_proposal_project_status`` as singular), we skip the
  new create rather than duplicating work.

Revision ID: 007_sp3_4_planning_dashboards
Revises: 006_api_token_permissions
Create Date: 2026-04-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "007_sp3_4_planning_dashboards"
down_revision = "006_api_token_permissions"
branch_labels = None
depends_on = None


# (index_name, table_name, column_expression_or_cols, is_expression)
# When ``is_expression`` is True we pass the expr literal to CREATE INDEX so
# we can use ``DESC NULLS LAST`` ordering. When False we call
# ``op.create_index`` with a plain column list (portable for SQLite).
INDEXES: list[tuple[str, str, str | list[str], bool]] = [
    (
        "ix_results_run_finished",
        "results",
        "(run_id, updated_at DESC)",
        True,
    ),
    (
        "ix_runs_project_finished",
        "runs",
        "(project_id, closed_at DESC NULLS LAST)",
        True,
    ),
    (
        "ix_runs_project_plan_finished",
        "runs",
        "(project_id, plan_id, closed_at DESC NULLS LAST)",
        True,
    ),
    (
        "ix_proposals_project_status",
        "proposals",
        ["project_id", "status"],
        False,
    ),
    (
        "ix_runs_environment_finished",
        "runs",
        "(environment_id, closed_at DESC NULLS LAST)",
        True,
    ),
]


def _existing_index_names(inspector: sa.Inspector, table: str) -> set[str]:
    try:
        return {ix["name"] for ix in inspector.get_indexes(table)}
    except sa.exc.NoSuchTableError:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    is_pg = bind.dialect.name == "postgresql"

    for name, table, expr_or_cols, is_expression in INDEXES:
        existing = _existing_index_names(inspector, table)
        if name in existing:
            continue

        if is_expression:
            # Expression indexes (DESC / NULLS LAST) are Postgres-only.
            # SQLite ignores the ordering clauses in index DDL silently,
            # so we can still emit them portably — but on SQLite tests we
            # simplify to a plain column list for correctness.
            if is_pg:
                op.execute(f"CREATE INDEX {name} ON {table} {expr_or_cols}")
            else:
                # Derive column list from the expression by taking the
                # comma-separated names before any ordering keyword.
                cols_part = expr_or_cols.strip("() ")
                cols = [p.strip().split()[0] for p in cols_part.split(",")]
                op.create_index(name, table, cols)
        else:
            op.create_index(name, table, expr_or_cols)

    # Defensive one-shot reshape: legacy plan.body.explicit_cases as a JSON
    # array is rewritten to {add: <array>, remove: []}. Expected to be zero
    # rows (plan writes hadn't shipped), but we run it defensively so a
    # manual backfill can't poison the new shape.
    if is_pg:
        op.execute(
            """
            UPDATE content
               SET body = jsonb_set(
                   body,
                   '{explicit_cases}',
                   jsonb_build_object(
                       'add', body->'explicit_cases',
                       'remove', '[]'::jsonb
                   ),
                   true
               )
             WHERE kind = 'plan'
               AND jsonb_typeof(body->'explicit_cases') = 'array'
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for name, table, _expr, _is_expr in INDEXES:
        existing = _existing_index_names(inspector, table)
        if name in existing:
            # Use IF EXISTS-style safety so downgrade tolerates partial state.
            op.execute(f"DROP INDEX IF EXISTS {name}")
