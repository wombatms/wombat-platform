"""Change content.tags column from JSON to JSONB for containment filtering.

The Content model declared tags as JSON but the 001_initial migration already
created it as JSONB.  This revision makes the *migration state* authoritative
and matches the updated model declaration (mapped_column(JSONB)).  On a fresh
database this is a no-op at the Postgres level (the column is already JSONB).
On an old database that was created via create_all (pure JSON), the ALTER will
convert the column to JSONB.

Revision ID: 002_tags_jsonb
Revises: 001_initial
Create Date: 2026-04-20
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_tags_jsonb"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE content ALTER COLUMN tags TYPE JSONB USING tags::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE content ALTER COLUMN tags TYPE JSON USING tags::json")
