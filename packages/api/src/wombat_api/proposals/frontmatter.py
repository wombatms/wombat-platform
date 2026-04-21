"""Mutate the YAML `review:` frontmatter block on a proposed body."""

from __future__ import annotations

import copy
from datetime import UTC, datetime


def mutate_review_block(
    body: dict,
    *,
    approver_display_name: str,
    approver_email: str,
    action: str,  # "approve" | "direct_publish"
    now: datetime | None = None,
) -> dict:
    """Return a deep-copy of `body` with the `review:` block updated.

    The body shape matches wombat_core.parsing: {"frontmatter": dict, "markdown": str}.
    If frontmatter has no `review:` key, one is added. Existing reviewers are
    preserved; the approver is appended to `approved_by` if not already present.
    """
    now = now or datetime.now(UTC)
    mutated = copy.deepcopy(body)
    fm = mutated.setdefault("frontmatter", {})
    review = fm.setdefault("review", {})
    review["state"] = "approved"
    review["approved_at"] = now.isoformat()
    approver_entry = f"{approver_display_name} <{approver_email}>"
    approved_by = review.setdefault("approved_by", [])
    if approver_entry not in approved_by:
        approved_by.append(approver_entry)
    if action == "direct_publish":
        review["published_directly"] = True
    return mutated
