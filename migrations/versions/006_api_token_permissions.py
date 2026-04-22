"""SP3.3: add permissions column to api_tokens.

Adds a nullable JSON column ``permissions`` to ``api_tokens`` that stores
the explicit subset of Permission values granted at issuance time.  NULL
means "defer to role defaults" (backward-compatible with all SP3.2 tokens).

Revision ID: 006_api_token_permissions
Revises: 005_sp3_3_execution
Create Date: 2026-04-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "006_api_token_permissions"
down_revision = "005_sp3_3_execution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.add_column(
        "api_tokens",
        sa.Column(
            "permissions",
            sa.dialects.postgresql.JSONB() if is_pg else sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("api_tokens", "permissions")
