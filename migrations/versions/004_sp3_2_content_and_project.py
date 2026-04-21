"""sp3.2: projects.git_url + content.stale_embedding

Adds the git remote URL to the projects table (used by the publisher to clone
and push approved proposals) and a stale_embedding flag on the content table
(set True when the publisher writes a new file but inline reindex fails, so
the background embedder knows to re-embed the row on its next pass).

Revision ID: 004_sp3_2_content_and_project
Revises: 003_sp3_2_proposals
Create Date: 2026-04-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004_sp3_2_content_and_project"
down_revision: str | None = "003_sp3_2_proposals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # projects.git_url: nullable — not all projects use the publish workflow.
    op.add_column(
        "projects",
        sa.Column("git_url", sa.String(), nullable=True),
    )

    # content.stale_embedding: NOT NULL with server_default false so existing
    # rows are backfilled to False without a table rewrite.
    op.add_column(
        "content",
        sa.Column(
            "stale_embedding",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("content", "stale_embedding")
    op.drop_column("projects", "git_url")
