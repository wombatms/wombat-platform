"""Widget: review_backlog — Open proposal count + oldest 5 awaiting review.

Counts proposals with status='open' (the "pending review" state introduced in
SP3.2) and surfaces the oldest five so reviewers can triage without leaving the
project dashboard.

Title field: ``proposals.proposed_title`` — a dedicated VARCHAR column on
``ProposalDB`` that is set at proposal-creation time and does not require a
JSONB extraction.

Registered at import time via side-effect: ``REGISTRY.register(META, _query)``.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.dashboards.registry import REGISTRY, WidgetFilters, WidgetMeta, WidgetScope

META: WidgetMeta = {
    "slug": "review_backlog",
    "title": "Review backlog",
    "scope_kinds": {"project"},
    "requires": [],
}


async def _query(scope: WidgetScope, filters: WidgetFilters, session: AsyncSession) -> dict:
    """Return the count of open proposals and the oldest five pending review.

    Parameters
    ----------
    scope:
        ``kind`` must be ``"project"``; ``project_id`` is the UUID string of
        the project.  This widget does not support plan scope — the route layer
        enforces ``scope_kinds`` before calling here, so no guard is needed.
    filters:
        Unused (review backlog has no time-window or environment filter).

    Returns
    -------
    dict with shape::

        {
            "count": <int>,           # total open proposals for the project
            "oldest": [               # up to 5 oldest, sorted by created_at ASC
                {
                    "id":       "<uuid>",
                    "kind":     "<str>",     # testcase | shared_step | plan | suite | …
                    "title":    "<str>",     # proposed_title from ProposalDB
                    "age_days": <int>,       # whole days since created_at
                },
                …
            ],
        }
    """
    project_id = scope["project_id"]

    count_sql = sa.text(
        "SELECT count(*) AS total"
        "  FROM proposals"
        " WHERE project_id = :pid"
        "   AND status = 'open'"
    )

    oldest_sql = sa.text(
        "SELECT"
        "   id::text,"
        "   kind,"
        "   proposed_title AS title,"
        "   extract(day FROM now() - created_at)::int AS age_days"
        "  FROM proposals"
        " WHERE project_id = :pid"
        "   AND status = 'open'"
        " ORDER BY created_at ASC"
        " LIMIT 5"
    )

    params = {"pid": project_id}

    total_row = (await session.execute(count_sql, params)).one()
    oldest_rows = (await session.execute(oldest_sql, params)).all()

    oldest = [
        {
            "id": row.id,
            "kind": row.kind,
            "title": row.title,
            "age_days": int(row.age_days) if row.age_days is not None else 0,
        }
        for row in oldest_rows
    ]

    return {
        "count": int(total_row.total),
        "oldest": oldest,
    }


REGISTRY.register(META, _query)
